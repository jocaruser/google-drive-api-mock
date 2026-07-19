// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeGoogle, type FakeGoogle } from '../src/handler.ts'

/**
 * Pins the Google contract details consumers rely on: envelope kinds,
 * default projections, per-API error shapes, and write-response fields.
 */

import { DRIVE, SHEETS, bindCall } from './helpers.ts'

let rootDir: string
let fake: FakeGoogle

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdam-contract-'))
  fake = createFakeGoogle({ rootDir })
})

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true })
})

const call = bindCall(() => fake)

describe('Drive contract shapes', () => {
  it('files.list without fields returns the documented default envelope', async () => {
    await call('POST', `${DRIVE}/files`, {
      name: 'a',
      mimeType: 'application/vnd.google-apps.folder',
    })
    const list = await call('GET', `${DRIVE}/files?q=${encodeURIComponent("name='a'")}`)
    expect(list.json()).toEqual({
      kind: 'drive#fileList',
      incompleteSearch: false,
      files: [
        {
          kind: 'drive#file',
          id: 'fake-1',
          name: 'a',
          mimeType: 'application/vnd.google-apps.folder',
        },
      ],
    })
  })

  it('files.create without fields returns the default file projection', async () => {
    const created = await call('POST', `${DRIVE}/files`, {
      name: 'b',
      mimeType: 'application/vnd.google-apps.folder',
    })
    expect(created.json()).toEqual({
      kind: 'drive#file',
      id: 'fake-1',
      name: 'b',
      mimeType: 'application/vnd.google-apps.folder',
    })
  })

  it('401s carry the Drive envelope with location details', async () => {
    const response = await fake.handle(new Request(`${DRIVE}/files?q=trashed%3Dfalse`))
    expect(response.status).toBe(401)
    const body = (await response.json()) as {
      error: { errors: Record<string, string>[]; status: string }
    }
    expect(body.error.status).toBe('UNAUTHENTICATED')
    expect(body.error.errors[0]).toMatchObject({
      domain: 'global',
      reason: 'authError',
      location: 'Authorization',
      locationType: 'header',
    })
  })

  it('Sheets errors carry code/message/status without the legacy errors[]', async () => {
    const missing = await call('GET', `${SHEETS}/spreadsheets/nope`)
    expect(missing.status).toBe(404)
    expect(missing.json()).toEqual({
      error: {
        code: 404,
        message: 'Requested entity was not found.',
        status: 'NOT_FOUND',
      },
    })
  })
})

describe('Sheets contract shapes', () => {
  it('spreadsheets.create returns the spreadsheet envelope with url', async () => {
    const created = await call('POST', `${SHEETS}/spreadsheets`, {
      properties: { title: 'wb' },
      sheets: [{ properties: { title: 'tab1' } }],
    })
    expect(created.json()).toEqual({
      spreadsheetId: 'fake-1',
      properties: { title: 'wb' },
      sheets: [{ properties: { sheetId: 0, title: 'tab1', index: 0 } }],
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/fake-1/edit',
    })
  })

  it('values.update reports rows, columns and cells', async () => {
    await call('POST', `${SHEETS}/spreadsheets`, {
      properties: { title: 'wb' },
      sheets: [{ properties: { title: 't' } }],
    })
    const range = encodeURIComponent("'t'!A1")
    const updated = await call(
      'PUT',
      `${SHEETS}/spreadsheets/fake-1/values/${range}?valueInputOption=RAW`,
      { values: [['a', 'b', 'c'], ['d']] }
    )
    expect(updated.json()).toEqual({
      spreadsheetId: 'fake-1',
      updatedRange: "'t'!A1",
      updatedRows: 2,
      updatedColumns: 3,
      updatedCells: 4,
    })
  })

  it('values.clear echoes the cleared range', async () => {
    await call('POST', `${SHEETS}/spreadsheets`, {
      properties: { title: 'wb' },
      sheets: [{ properties: { title: 't' } }],
    })
    const cleared = await call(
      'POST',
      `${SHEETS}/spreadsheets/fake-1/values/${encodeURIComponent("'t'!A:ZZ")}:clear`
    )
    expect(cleared.json()).toEqual({
      spreadsheetId: 'fake-1',
      clearedRange: "'t'!A:ZZ",
    })
  })
})
