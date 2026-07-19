import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as api from '../src/index.ts'
import { parseCsv } from '../src/csv.ts'
import { FOLDER_MIME, SPREADSHEET_MIME } from '../src/store.ts'

import { DRIVE, SHEETS, bindCall, makeSheet } from './helpers.ts'

let rootDir: string
let fake: api.FakeGoogle

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdam-gaps-'))
  fake = api.createFakeGoogle({ rootDir })
})

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true })
})

const call = bindCall(() => fake)

describe('public entry point', () => {
  it('re-exports the full surface', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DriveStore',
      'FOLDER_MIME',
      'SPREADSHEET_MIME',
      'StoreError',
      'createFakeGoogle',
      'createFakeGoogleServer',
      'parseCsv',
      'serializeCsv',
    ])
  })
})

describe('csv corners', () => {
  it('unescapes doubled quotes and flushes a final unterminated row', () => {
    expect(parseCsv('a,"b""c"')).toEqual([['a', 'b"c']])
    expect(parseCsv('x,y')).toEqual([['x', 'y']])
    expect(parseCsv('a\r\nb\r\n')).toEqual([['a'], ['b']])
  })
})

describe('drive reparent and upload corners', () => {
  it('handles addParents-only and removeParents-only patches', async () => {
    const folderA = fake.store.createFile({ name: 'A', mimeType: FOLDER_MIME })
    const folderB = fake.store.createFile({ name: 'B', mimeType: FOLDER_MIME })
    const file = fake.store.createFile({
      name: 'f.txt',
      mimeType: 'text/plain',
      parents: [folderA.id],
      content: 'x',
    })
    await call('PATCH', `${DRIVE}/files/${file.id}?addParents=${folderB.id}`, '{}')
    expect(fake.store.get(file.id)?.parents).toEqual([folderA.id, folderB.id])
    await call('PATCH', `${DRIVE}/files/${file.id}?removeParents=${folderB.id}`, '{}')
    expect(fake.store.get(file.id)?.parents).toEqual([folderA.id])
  })

  it('upload PATCH with empty metadata replaces content without renaming', async () => {
    const file = fake.store.createFile({
      name: 'keep.json',
      mimeType: 'application/json',
      content: '{}',
    })
    const body = [
      '--b',
      'Content-Type: application/json',
      '',
      '{}',
      '--b',
      'Content-Type: application/json',
      '',
      '{"v":2}',
      '--b--',
    ].join('\r\n')
    const response = await fake.handle(
      new Request(
        `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=multipart`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer t',
            'Content-Type': 'multipart/related; boundary=b',
          },
          body,
        }
      )
    )
    expect(response.status).toBe(200)
    expect(fake.store.get(file.id)?.name).toBe('keep.json')
    expect(fake.store.readContent(file.id)).toBe('{"v":2}')
  })

  it('skips malformed multipart chunks lacking a header/body separator', async () => {
    const body = [
      '--b',
      'junk-without-blank-line',
      '--b',
      'Content-Type: application/json',
      '',
      '{"name":"ok.txt"}',
      '--b',
      'Content-Type: text/plain',
      '',
      'content',
      '--b--',
    ].join('\r\n')
    const response = await fake.handle(
      new Request(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer t',
            'Content-Type': 'multipart/related; boundary=b',
          },
          body,
        }
      )
    )
    expect(response.status).toBe(200)
  })

  it('uploads without a Content-Type header fail on the missing boundary', async () => {
    // A byte body keeps undici from auto-injecting a content-type header.
    const response = await fake.handle(
      new Request(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer t' },
          body: new TextEncoder().encode('x'),
        }
      )
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('boundary')
  })

  it('lists everything without a q filter and projects gets by default', async () => {
    const folder = fake.store.createFile({ name: 'only', mimeType: FOLDER_MIME })
    const all = await call('GET', `${DRIVE}/files?fields=files(id)`)
    expect((all.json() as { files: unknown[] }).files).toEqual([{ id: folder.id }])
    const got = await call('GET', `${DRIVE}/files/${folder.id}`)
    expect(got.json()).toEqual({
      kind: 'drive#file',
      id: folder.id,
      name: 'only',
      mimeType: FOLDER_MIME,
    })
  })

  it('drive POST with an empty body means an empty metadata object', async () => {
    const response = await fake.handle(
      new Request(`${DRIVE}/files`, {
        method: 'POST',
        headers: { Authorization: 'Bearer t' },
      })
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("Missing required string field 'name'")
  })
})

describe('drive query mismatch paths', () => {
  it('filters out files that fail each clause kind', async () => {
    const folder = fake.store.createFile({ name: 'parent', mimeType: FOLDER_MIME })
    fake.store.createFile({
      name: 'child.txt',
      mimeType: 'text/plain',
      parents: [folder.id],
      content: 'x',
    })
    const query = async (q: string) => {
      const result = await call(
        'GET',
        `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)`
      )
      return (result.json() as { files: unknown[] }).files
    }
    expect(await query(`name='child.txt' and 'nope' in parents`)).toEqual([])
    expect(await query(`name='child.txt' and trashed=true`)).toEqual([])
    expect(await query(`name='child.txt' and mimeType='image/png'`)).toEqual([])
  })
})

describe('handler rethrow of unexpected errors', () => {
  it('propagates non-StoreError failures instead of masking them', async () => {
    await expect(call('GET', `${DRIVE}/files/%E0%A4%A?fields=name`)).rejects.toThrow(
      URIError
    )
  })
})

describe('sheets remaining branches', () => {

  it('404s a bare /spreadsheets GET (list is not modelled)', async () => {
    expect((await call('GET', `${SHEETS}/spreadsheets`)).status).toBe(404)
  })

  it("rejects a range that is neither quoted nor plain ('!A1')", async () => {
    const id = await makeSheet(call)
    const bad = await call(
      'GET',
      `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent('!A1')}`
    )
    expect(bad.status).toBe(400)
    expect(bad.text).toContain('Unable to parse range')
  })

  it('trims trailing empty rows inside an explicit rectangle', async () => {
    const id = await makeSheet(call)
    fake.store.setValuesRect(id, 't', 0, 0, [['x'], [], ['y']])
    const rect = await call(
      'GET',
      `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent("'t'!A1:A2")}`
    )
    expect((rect.json() as { values: string[][] }).values).toEqual([['x']])
  })

  it('404s non-GET/PUT verbs on a values range and GET on :clear', async () => {
    const id = await makeSheet(call)
    const range = encodeURIComponent("'t'!A1")
    expect(
      (await call('DELETE', `${SHEETS}/spreadsheets/${id}/values/${range}`)).status
    ).toBe(404)
    expect(
      (await call('GET', `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent("'t'!A:ZZ")}:clear`))
        .status
    ).toBe(404)
  })

  it('reads a quoted title-only range as the whole sheet', async () => {
    const id = await makeSheet(call)
    fake.store.setValuesRect(id, 't', 0, 0, [['x']])
    const whole = await call(
      'GET',
      `${SHEETS}/spreadsheets/${id}/values/${encodeURIComponent("'t'")}`
    )
    expect((whole.json() as { values: string[][] }).values).toEqual([['x']])
  })

  it('creates spreadsheets without a sheets field and batchUpdates without a body', async () => {
    const created = await call('POST', `${SHEETS}/spreadsheets`, JSON.stringify({}))
    const id = (created.json() as { spreadsheetId: string }).spreadsheetId
    expect((created.json() as { sheets: unknown[] }).sheets).toEqual([])
    const empty = await call('POST', `${SHEETS}/spreadsheets/${id}:batchUpdate`)
    expect(empty.json()).toEqual({ spreadsheetId: id, replies: [] })
  })

  it('GET spreadsheet without fields returns the full envelope', async () => {
    const id = await makeSheet(call)
    const full = await call('GET', `${SHEETS}/spreadsheets/${id}`)
    expect(full.json()).toEqual({
      spreadsheetId: id,
      properties: { title: 'Untitled spreadsheet' },
      sheets: [{ properties: { sheetId: 0, title: 't', index: 0 } }],
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    })
  })

  it('rejects a PUT to a column range and malformed sheets bodies', async () => {
    const id = await makeSheet(call)
    const colRange = encodeURIComponent("'t'!A:C")
    expect(
      (
        await call(
          'PUT',
          `${SHEETS}/spreadsheets/${id}/values/${colRange}?valueInputOption=RAW`,
          JSON.stringify({ values: [['x']] })
        )
      ).status
    ).toBe(400)
    expect((await call('POST', `${SHEETS}/spreadsheets`, 'not json')).status).toBe(400)
    expect((await call('POST', `${SHEETS}/spreadsheets`, '[1]')).status).toBe(400)
  })
})

describe('store remaining branches', () => {
  it('creates an empty file when no content is given', () => {
    const meta = fake.store.createFile({ name: 'empty.txt', mimeType: 'text/plain' })
    expect(fake.store.readContent(meta.id)).toBe('')
  })

  it('reparenting onto an existing parent does not duplicate it', () => {
    const folder = fake.store.createFile({ name: 'f', mimeType: FOLDER_MIME })
    const file = fake.store.createFile({
      name: 'a.txt',
      mimeType: 'text/plain',
      parents: [folder.id],
      content: 'x',
    })
    const updated = fake.store.reparent(file.id, [folder.id], [])
    expect(updated.parents).toEqual([folder.id])
  })

  it('copies spreadsheets with their tab metadata', () => {
    const sheet = fake.store.createFile({ name: 'wb', mimeType: SPREADSHEET_MIME })
    fake.store.addTab(sheet.id, 'one')
    fake.store.addTab(sheet.id, 'two')
    const copy = fake.store.copy(sheet.id, 'wb2')
    expect(fake.store.listTabs(copy.id)).toEqual([
      { sheetId: 0, title: 'one' },
      { sheetId: 1, title: 'two' },
    ])
  })
})
