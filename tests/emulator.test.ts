// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeGoogle, type FakeGoogle } from '../src/handler.ts'
import { parseQuery } from '../src/drive.ts'
import { applyFieldMask, parseFieldMask } from '../src/fields.ts'
import { StoreError } from '../src/store.ts'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const SHEETS = 'https://sheets.googleapis.com/v4'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

let rootDir: string
let fake: FakeGoogle

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'google-drive-api-mock-'))
  fake = createFakeGoogle({ rootDir })
})

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true })
})

async function call(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; text: string; json: () => unknown }> {
  const init: RequestInit = {
    method,
    headers: { Authorization: 'Bearer test-token', ...headers },
  }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const response = await fake.handle(new Request(url, init))
  const text = await response.text()
  return { status: response.status, text, json: () => JSON.parse(text) }
}

function range(spreadsheetId: string, ref: string, suffix = ''): string {
  return `${SHEETS}/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(ref)}${suffix}`
}

async function createShopFixture(): Promise<{
  folderId: string
  spreadsheetId: string
  metadataFileId: string
}> {
  const folder = await call('POST', `${DRIVE}/files`, {
    name: 'illo3d',
    mimeType: FOLDER_MIME,
  })
  const folderId = (folder.json() as { id: string }).id
  const spreadsheet = await call('POST', `${SHEETS}/spreadsheets`, {
    properties: { title: 'illo3d-data' },
    sheets: [{ properties: { title: 'clients' } }, { properties: { title: 'jobs' } }],
  })
  const spreadsheetId = (spreadsheet.json() as { spreadsheetId: string }).spreadsheetId
  await call('PATCH', `${DRIVE}/files/${spreadsheetId}?addParents=${folderId}&removeParents=`, {})
  const boundary = 'illo3d-multipart'
  const upload = await call(
    'POST',
    `${UPLOAD}/files?uploadType=multipart`,
    [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({
        name: 'illo3d.metadata.json',
        parents: [folderId],
        mimeType: 'application/json',
      }),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      JSON.stringify({ app: 'illo3d', version: '3.0.0', spreadsheetId }),
      `--${boundary}--`,
    ].join('\r\n'),
    { 'Content-Type': `multipart/related; boundary=${boundary}` }
  )
  const metadataFileId = (upload.json() as { id: string }).id
  return { folderId, spreadsheetId, metadataFileId }
}

describe('auth', () => {
  it('rejects requests without a bearer token, except alt=media downloads', async () => {
    const bare = await fake.handle(new Request(`${DRIVE}/files?q=trashed%3Dfalse`))
    expect(bare.status).toBe(401)

    const { metadataFileId } = await createShopFixture()
    const media = await fake.handle(
      new Request(`${DRIVE}/files/${metadataFileId}?alt=media`)
    )
    expect(media.status).toBe(200)
  })
})

describe('drive files', () => {
  it('creates, lists via q, downloads and deletes through the app call shapes', async () => {
    const { folderId, spreadsheetId, metadataFileId } = await createShopFixture()

    const q = encodeURIComponent(
      `name='illo3d.metadata.json' and '${folderId}' in parents and trashed=false`
    )
    const list = await call('GET', `${DRIVE}/files?q=${q}&fields=files(id)&pageSize=1`)
    expect(list.json()).toEqual({ files: [{ id: metadataFileId }] })

    const media = await call('GET', `${DRIVE}/files/${metadataFileId}?alt=media`)
    expect((media.json() as { spreadsheetId: string }).spreadsheetId).toBe(spreadsheetId)

    const name = await call('GET', `${DRIVE}/files/${folderId}?fields=name`)
    expect(name.json()).toEqual({ name: 'illo3d' })

    await call('DELETE', `${DRIVE}/files/${metadataFileId}`)
    const after = await call('GET', `${DRIVE}/files?q=${q}&fields=files(id)`)
    expect(after.json()).toEqual({ files: [] })
  })

  it('404s with Google-shaped errors on unknown files', async () => {
    const missing = await call('GET', `${DRIVE}/files/nope?fields=name`)
    expect(missing.status).toBe(404)
    expect(missing.json()).toEqual({
      error: { code: 404, message: 'File not found: nope.', status: 'NOT_FOUND' },
    })
  })

  it('fails loudly on q clauses outside the supported grammar', async () => {
    const bad = await call(
      'GET',
      `${DRIVE}/files?q=${encodeURIComponent("sharedWithMe=true and name='x'")}`
    )
    expect(bad.status).toBe(400)
    expect(bad.text).toContain('Unsupported q clause')
  })

  it('serves image thumbnails through an auth-exempt self link', async () => {
    const { folderId } = await createShopFixture()
    const boundary = 'b'
    await call(
      'POST',
      `${UPLOAD}/files?uploadType=multipart`,
      [
        `--${boundary}`,
        'Content-Type: application/json',
        '',
        JSON.stringify({ name: 'logo.svg', parents: [folderId], mimeType: 'image/svg+xml' }),
        `--${boundary}`,
        'Content-Type: image/svg+xml',
        '',
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
        `--${boundary}--`,
      ].join('\r\n'),
      { 'Content-Type': `multipart/related; boundary=${boundary}` }
    )

    const q = encodeURIComponent(`name='logo.svg' and '${folderId}' in parents and trashed=false`)
    const list = await call(
      'GET',
      `${DRIVE}/files?q=${q}&fields=files(id,thumbnailLink)&pageSize=1`
    )
    const [file] = (list.json() as { files: { id: string; thumbnailLink: string }[] }).files
    expect(file.thumbnailLink).toBe(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    )
    const image = await fake.handle(new Request(file.thumbnailLink))
    expect(image.status).toBe(200)
    expect(await image.text()).toContain('<svg')
  })
})

describe('duplicate names (migration rename dance)', () => {
  it('allows sibling name collisions and renormalizes disk paths when freed', async () => {
    const { folderId, spreadsheetId } = await createShopFixture()
    await call('PUT', range(spreadsheetId, "'clients'!A1", '?valueInputOption=RAW'), {
      values: [['id'], ['c1']],
    })

    const copy = await call('POST', `${DRIVE}/files/${spreadsheetId}/copy`, {
      name: 'illo3d-data.v1.v3.migration',
      parents: [folderId],
    })
    const workingId = (copy.json() as { id: string }).id

    // Rename the copy onto the original's name while the original still exists.
    const clash = await call('PATCH', `${DRIVE}/files/${workingId}`, { name: 'illo3d-data' })
    expect(clash.status).toBe(200)
    expect(fs.readdirSync(path.join(rootDir, 'illo3d')).sort()).toEqual([
      'illo3d-data',
      `illo3d-data~${workingId}`,
      'illo3d.metadata.json',
    ])

    // Freeing the name renormalizes the decorated path.
    await call('PATCH', `${DRIVE}/files/${spreadsheetId}`, { name: 'illo3d-data.v1.backup' })
    expect(fs.readdirSync(path.join(rootDir, 'illo3d')).sort()).toEqual([
      'illo3d-data',
      'illo3d-data.v1.backup',
      'illo3d.metadata.json',
    ])
    expect(
      fs.readFileSync(path.join(rootDir, 'illo3d', 'illo3d-data', 'clients.csv'), 'utf8')
    ).toBe('id\nc1\n')

    // Deleting a spreadsheet removes its tree.
    await call('DELETE', `${DRIVE}/files/${spreadsheetId}`)
    expect(fs.existsSync(path.join(rootDir, 'illo3d', 'illo3d-data.v1.backup'))).toBe(false)
  })
})

describe('sheets values', () => {
  it('writes rectangles, reads with trailing-empty trimming, clears whole sheets', async () => {
    const { spreadsheetId } = await createShopFixture()

    await call('PUT', range(spreadsheetId, "'clients'!A1", '?valueInputOption=RAW'), {
      values: [
        ['id', 'name', 'email'],
        ['c1', 'Acme, Inc.', ''],
      ],
    })
    expect(
      fs.readFileSync(
        path.join(rootDir, 'illo3d', 'illo3d-data', 'clients.csv'),
        'utf8'
      )
    ).toBe('id,name,email\nc1,"Acme, Inc.",\n')

    const all = await call('GET', range(spreadsheetId, "'clients'!A:ZZ", '?majorDimension=ROWS'))
    expect((all.json() as { values: string[][] }).values).toEqual([
      ['id', 'name', 'email'],
      ['c1', 'Acme, Inc.'],
    ])

    const header = await call('GET', range(spreadsheetId, "'clients'!1:1"))
    expect((header.json() as { values: string[][] }).values).toEqual([
      ['id', 'name', 'email'],
    ])

    const empty = await call('GET', range(spreadsheetId, "'jobs'!A:ZZ"))
    expect('values' in (empty.json() as object)).toBe(false)

    // Rectangle semantics: a header rewrite must not clobber data rows.
    await call('PUT', range(spreadsheetId, "'clients'!A1", '?valueInputOption=RAW'), {
      values: [['id', 'name', 'email', 'phone']],
    })
    const merged = await call('GET', range(spreadsheetId, "'clients'!A:ZZ"))
    expect((merged.json() as { values: string[][] }).values).toEqual([
      ['id', 'name', 'email', 'phone'],
      ['c1', 'Acme, Inc.'],
    ])

    await call('POST', range(spreadsheetId, "'clients'!A:ZZ", ':clear'))
    const cleared = await call('GET', range(spreadsheetId, "'clients'!A:ZZ"))
    expect('values' in (cleared.json() as object)).toBe(false)
  })

  it('mirrors Google errors: unknown spreadsheet, bad range, duplicate addSheet', async () => {
    const { spreadsheetId } = await createShopFixture()

    const missing = await call('GET', range('nope', "'clients'!A:ZZ"))
    expect(missing.status).toBe(404)
    expect(missing.text).toContain('Requested entity was not found.')

    const badRange = await call('GET', range(spreadsheetId, "'nope'!A:ZZ"))
    expect(badRange.status).toBe(400)
    expect(badRange.text).toContain('Unable to parse range')

    const duplicate = await call('POST', `${SHEETS}/spreadsheets/${spreadsheetId}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title: 'clients' } } }],
    })
    expect(duplicate.status).toBe(400)
    expect(duplicate.text).toContain('already exists')

    const added = await call('POST', `${SHEETS}/spreadsheets/${spreadsheetId}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title: 'inventory' } } }],
    })
    expect(added.status).toBe(200)

    const meta = await call(
      'GET',
      `${SHEETS}/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`
    )
    expect(meta.json()).toEqual({
      sheets: [
        { properties: { title: 'clients' } },
        { properties: { title: 'jobs' } },
        { properties: { title: 'inventory' } },
      ],
    })

    const put = await call('PUT', range(spreadsheetId, "'clients'!A1"), { values: [['x']] })
    expect(put.status).toBe(400)
    expect(put.text).toContain('valueInputOption=RAW is required')
  })
})

describe('persistence and seeding', () => {
  it('reloads state from the index so a second mount sees the same world', async () => {
    const { folderId, spreadsheetId } = await createShopFixture()
    await call('PUT', range(spreadsheetId, "'clients'!A1", '?valueInputOption=RAW'), {
      values: [['id'], ['c1']],
    })

    const remounted = createFakeGoogle({ rootDir })
    expect(remounted.store.require(folderId).name).toBe('illo3d')
    expect(remounted.store.getValues(spreadsheetId, 'clients')).toEqual([['id'], ['c1']])
  })

  it('honors assignId for pinned test ids and rejects duplicates', async () => {
    const pinned = createFakeGoogle({
      rootDir: path.join(rootDir, 'pinned'),
      assignId: (file) => (file.mimeType === FOLDER_MIME ? 'my-folder' : undefined),
    })
    const created = pinned.store.createFile({ name: 'a', mimeType: FOLDER_MIME })
    expect(created.id).toBe('my-folder')
    expect(() => pinned.store.createFile({ name: 'b', mimeType: FOLDER_MIME })).toThrow(
      StoreError
    )
  })
})

describe('query and field-mask parsers', () => {
  it("splits on ' and ' outside quotes and unescapes \\'", () => {
    expect(
      parseQuery("name='it''s and more.png' and 'folder id' in parents and trashed=false")
    ).toEqual({ name: "it''s and more.png", parent: 'folder id', trashed: false })
    expect(parseQuery("name='a\\'b'")).toEqual({ name: "a'b" })
    expect(() => parseQuery('starred=true')).toThrow('Unsupported q clause')
  })

  it('projects nested masks and omits absent values', () => {
    const mask = parseFieldMask('files(id,thumbnailLink),kind')
    expect(
      applyFieldMask({ files: [{ id: '1', name: 'x' }, { id: '2', thumbnailLink: 't' }] }, mask)
    ).toEqual({ files: [{ id: '1' }, { id: '2', thumbnailLink: 't' }] })
    expect(applyFieldMask({ sheets: [{ properties: { sheetId: 0, title: 'a' } }] },
      parseFieldMask('sheets.properties.title')
    )).toEqual({ sheets: [{ properties: { title: 'a' } }] })
    expect(() => parseFieldMask('files(id')).toThrow('Unbalanced fields mask')
  })
})
