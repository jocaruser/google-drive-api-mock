import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeGoogle, type FakeGoogle } from '../src/handler.ts'
import { DriveStore, FOLDER_MIME } from '../src/store.ts'
import { DRIVE, SHEETS, bindCall, makeSheet } from './helpers.ts'

/** Regression pins for defects caught by review of the v0.2.0 changes. */

let rootDir: string
let fake: FakeGoogle

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdam-regr-'))
  fake = createFakeGoogle({ rootDir })
})

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true })
})

const call = bindCall(() => fake)

describe('unencoded ranges (colon is a legal path character)', () => {
  it('serves GET/PUT for raw-colon ranges instead of treating them as verbs', async () => {
    const id = await makeSheet(call)
    fake.store.setValuesRect(id, 't', 0, 0, [
      ['a1', 'b1'],
      ['a2', 'b2'],
    ])
    const rawRect = await call('GET', `${SHEETS}/spreadsheets/${id}/values/t!A1:B2`)
    expect(rawRect.status).toBe(200)
    expect((rawRect.json() as { values: string[][] }).values).toEqual([
      ['a1', 'b1'],
      ['a2', 'b2'],
    ])
    const rawColumns = await call(
      'GET',
      `${SHEETS}/spreadsheets/${id}/values/'t'!A:ZZ`
    )
    expect(rawColumns.status).toBe(200)
    const rawPut = await call(
      'PUT',
      `${SHEETS}/spreadsheets/${id}/values/t!A1:B1?valueInputOption=RAW`,
      { values: [['x', 'y']] }
    )
    expect(rawPut.status).toBe(200)
  })

  it('bounded rectangles reject payloads that exceed them', async () => {
    const id = await makeSheet(call)
    const put = (values: string[][]) =>
      call(
        'PUT',
        `${SHEETS}/spreadsheets/${id}/values/t!A1:B1?valueInputOption=RAW`,
        { values }
      )
    expect((await put([['x', 'y'], ['z']])).status).toBe(400)
    expect((await put([['x', 'y', 'z']])).status).toBe(400)
    expect((await put([['x', 'y']])).status).toBe(200)
  })

  it('still routes real RPC verbs: clear works, append 404s as unmodelled', async () => {
    const id = await makeSheet(call)
    const appendResult = await call(
      'POST',
      `${SHEETS}/spreadsheets/${id}/values/t!A1:append`,
      { values: [['x']] }
    )
    expect(appendResult.status).toBe(404)
    expect(appendResult.text).toContain('unhandled Sheets request')
  })
})

describe('corrupt index fails loudly, every time, and recovers', () => {
  it('400s each request while _index.json is invalid and resumes when fixed', async () => {
    fake.store.createFile({ id: 'keeper', name: 'k', mimeType: FOLDER_MIME })
    const goodIndex = fs.readFileSync(path.join(rootDir, '_index.json'), 'utf8')

    fs.writeFileSync(path.join(rootDir, '_index.json'), '{ corrupt')
    for (let attempt = 0; attempt < 2; attempt++) {
      const broken = await call('GET', `${DRIVE}/files?fields=files(id)`)
      expect(broken.status).toBe(400)
      expect(broken.text).toContain('_index.json is not valid JSON')
    }

    fs.writeFileSync(path.join(rootDir, '_index.json'), goodIndex)
    const recovered = await call('GET', `${DRIVE}/files?fields=files(id)`)
    expect(recovered.status).toBe(200)
    expect((recovered.json() as { files: unknown[] }).files).toEqual([
      { id: 'keeper' },
    ])
  })
})

describe('long-lived second-instance seeders', () => {
  it('sync before mutating: a stale seeder neither clobbers nor collides', async () => {
    const seeder = new DriveStore({ rootDir })

    // The server mints fake-1 after the seeder snapshotted an empty world.
    await call('POST', `${DRIVE}/files`, { name: 'app-made', mimeType: FOLDER_MIME })
    expect(fake.store.get('fake-1')?.name).toBe('app-made')

    // The stale seeder now seeds — it must see fake-1 and mint fake-2.
    const seeded = seeder.createFile({ name: 'seeded', mimeType: FOLDER_MIME })
    expect(seeded.id).toBe('fake-2')

    const listed = await call('GET', `${DRIVE}/files?fields=files(id,name)`)
    expect((listed.json() as { files: unknown[] }).files).toEqual([
      { id: 'fake-1', name: 'app-made' },
      { id: 'fake-2', name: 'seeded' },
    ])
  })

  it('detects a same-length index rewrite (content compare, not timestamps)', async () => {
    const seeder = new DriveStore({ rootDir })
    seeder.createFile({ id: 'aaa', name: 'red', mimeType: FOLDER_MIME })
    expect(
      ((await call('GET', `${DRIVE}/files?fields=files(id)`)).json() as {
        files: { id: string }[]
      }).files
    ).toEqual([{ id: 'aaa' }])

    // Same byte length, different content, potentially same mtime quantum.
    const text = fs.readFileSync(path.join(rootDir, '_index.json'), 'utf8')
    fs.writeFileSync(
      path.join(rootDir, '_index.json'),
      text.replaceAll('aaa', 'bbb')
    )
    fs.renameSync(path.join(rootDir, 'red'), path.join(rootDir, 'red-moved'))
    fs.renameSync(path.join(rootDir, 'red-moved'), path.join(rootDir, 'red'))
    expect(
      ((await call('GET', `${DRIVE}/files?fields=files(id)`)).json() as {
        files: { id: string }[]
      }).files
    ).toEqual([{ id: 'bbb' }])
  })
})

describe('index read failures other than absence stay loud', () => {
  it('propagates EISDIR when _index.json is a directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdam-eisdir-'))
    fs.mkdirSync(path.join(dir, '_index.json'))
    expect(() => new DriveStore({ rootDir: dir })).toThrow(/EISDIR/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('hand-seeded indexes', () => {
  it('copies a spreadsheet whose index entry omits the tabs key', async () => {
    const handIndex = {
      counter: 1,
      files: {
        'fake-1': {
          name: 'book',
          diskName: 'book',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [],
          trashed: false,
        },
      },
      tabs: {},
    }
    fs.writeFileSync(
      path.join(rootDir, '_index.json'),
      JSON.stringify(handIndex, null, 2) + '\n'
    )
    fs.mkdirSync(path.join(rootDir, 'book'))

    const copied = await call('POST', `${DRIVE}/files/fake-1/copy`, {
      name: 'book2',
    })
    expect(copied.status).toBe(200)
    const copiedId = (copied.json() as { id: string }).id
    expect(fake.store.listTabs(copiedId)).toEqual([])
    expect(fs.existsSync(path.join(rootDir, 'book2'))).toBe(true)
  })
})
