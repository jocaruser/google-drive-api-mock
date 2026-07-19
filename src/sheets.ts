import { applyFieldMask, parseFieldMask } from './fields.ts'
import { DriveStore, SPREADSHEET_MIME, StoreError } from './store.ts'
import type { ApiResult } from './drive.ts'

/**
 * Sheets v4 subset: spreadsheets.create, spreadsheets.get, `addSheet` via
 * batchUpdate, and values get/update(RAW)/clear. Tab data lives as one CSV per
 * tab in the store; `values.get` trims trailing empty rows/cells and omits
 * `values` entirely when the range is empty, matching Google.
 */

/** Google's spreadsheets.values RPC verbs (the `…/values/{range}:verb` set). */
const VALUES_VERBS = new Set([
  'append',
  'batchClear',
  'batchClearByDataFilter',
  'batchGet',
  'batchGetByDataFilter',
  'batchUpdate',
  'batchUpdateByDataFilter',
  'clear',
])

interface ParsedRange {
  title: string
  ref: string | null
}

function parseRange(range: string): ParsedRange {
  const quoted = /^'((?:[^']|'')*)'(?:!(.+))?$/.exec(range)
  if (quoted !== null) {
    return { title: quoted[1].replace(/''/g, "'"), ref: quoted[2] ?? null }
  }
  const plain = /^([^!]+)(?:!(.+))?$/.exec(range)
  if (plain !== null) return { title: plain[1], ref: plain[2] ?? null }
  throw new StoreError(400, `Unable to parse range: ${range}`)
}

/** `A` → 0, `Z` → 25, `AA` → 26 … */
function columnIndex(letters: string): number {
  let value = 0
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64)
  return value - 1
}

/**
 * `form` keeps range kinds distinguishable after parsing: a bare cell is an
 * exact cell for reads/clears but an expandable anchor for writes (real
 * Sheets semantics illo3d's whole-matrix `A1` writes rely on), while a
 * bounded rectangle constrains the write.
 */
interface Rect {
  form: 'all' | 'cell' | 'rect' | 'colRange' | 'rowRange'
  row0: number
  col0: number
  row1: number | null
  col1: number | null
}

function parseRef(ref: string | null, range: string): Rect {
  if (ref === null)
    return { form: 'all', row0: 0, col0: 0, row1: null, col1: null }
  let match: RegExpExecArray | null
  if ((match = /^([A-Z]+):([A-Z]+)$/.exec(ref)) !== null) {
    return {
      form: 'colRange',
      row0: 0,
      col0: columnIndex(match[1]),
      row1: null,
      col1: columnIndex(match[2]),
    }
  }
  if ((match = /^(\d+):(\d+)$/.exec(ref)) !== null) {
    return {
      form: 'rowRange',
      row0: Number(match[1]) - 1,
      col0: 0,
      row1: Number(match[2]) - 1,
      col1: null,
    }
  }
  if ((match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref)) !== null) {
    return {
      form: 'rect',
      row0: Number(match[2]) - 1,
      col0: columnIndex(match[1]),
      row1: Number(match[4]) - 1,
      col1: columnIndex(match[3]),
    }
  }
  if ((match = /^([A-Z]+)(\d+)$/.exec(ref)) !== null) {
    const row0 = Number(match[2]) - 1
    const col0 = columnIndex(match[1])
    return { form: 'cell', row0, col0, row1: row0, col1: col0 }
  }
  throw new StoreError(400, `Unable to parse range: ${range}`)
}

/** Slice `matrix` to the rect, then trim trailing empty rows and cells. */
function readRect(matrix: string[][], rect: Rect): string[][] {
  const rows = matrix.slice(rect.row0, rect.row1 === null ? undefined : rect.row1 + 1)
  const sliced = rows.map((row) =>
    row.slice(rect.col0, rect.col1 === null ? undefined : rect.col1 + 1)
  )
  const trimmed = sliced.map((row) => {
    const copy = [...row]
    while (copy.length > 0 && copy[copy.length - 1] === '') copy.pop()
    return copy
  })
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0)
    trimmed.pop()
  return trimmed
}

function spreadsheetEnvelope(store: DriveStore, id: string): Record<string, unknown> {
  const meta = store.require(id)
  return {
    spreadsheetId: id,
    properties: { title: meta.name },
    sheets: store.listTabs(id).map((tab, index) => ({
      properties: { sheetId: tab.sheetId, title: tab.title, index },
    })),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
  }
}

function cellValues(body: Record<string, unknown>): string[][] {
  const values = body.values
  if (values === undefined) return []
  if (!Array.isArray(values) || values.some((row) => !Array.isArray(row)))
    throw new StoreError(400, 'values must be an array of rows')
  return (values as unknown[][]).map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
  )
}

export function handleSheets(
  store: DriveStore,
  method: string,
  url: URL,
  bodyText: string
): ApiResult {
  const subPath = url.pathname.replace(/^\/v4/, '')
  const fields = url.searchParams.get('fields')

  if (subPath === '/spreadsheets' && method === 'POST') {
    const body = parseJson(bodyText)
    const properties = (body.properties ?? {}) as Record<string, unknown>
    const title =
      typeof properties.title === 'string' ? properties.title : 'Untitled spreadsheet'
    const meta = store.createFile({ name: title, mimeType: SPREADSHEET_MIME })
    const sheets = Array.isArray(body.sheets) ? body.sheets : []
    for (const sheet of sheets as { properties?: { title?: unknown } }[]) {
      const tabTitle = sheet.properties?.title
      if (typeof tabTitle !== 'string')
        throw new StoreError(400, 'sheets[].properties.title must be a string')
      store.addTab(meta.id, tabTitle)
    }
    return { status: 200, json: spreadsheetEnvelope(store, meta.id) }
  }

  let match: RegExpExecArray | null

  if ((match = /^\/spreadsheets\/([^/:]+):batchUpdate$/.exec(subPath)) !== null) {
    if (method !== 'POST') throw unhandled(method, url)
    const id = decodeURIComponent(match[1])
    store.requireSpreadsheet(id)
    const body = parseJson(bodyText)
    const requests = Array.isArray(body.requests) ? body.requests : []
    const replies: unknown[] = []
    for (const request of requests as Record<string, unknown>[]) {
      const keys = Object.keys(request)
      if (keys.length === 1 && keys[0] === 'addSheet') {
        const addSheet = request.addSheet as { properties?: { title?: unknown } }
        const title = addSheet.properties?.title
        if (typeof title !== 'string')
          throw new StoreError(400, 'addSheet.properties.title must be a string')
        const tab = store.addTab(id, title)
        replies.push({
          addSheet: { properties: { sheetId: tab.sheetId, title: tab.title } },
        })
      } else {
        throw new StoreError(
          400,
          `google-drive-api-mock: unsupported batchUpdate request: ${keys.join(',')}`
        )
      }
    }
    return { status: 200, json: { spreadsheetId: id, replies } }
  }

  if ((match = /^\/spreadsheets\/([^/:]+)$/.exec(subPath)) !== null) {
    if (method !== 'GET') throw unhandled(method, url)
    const id = decodeURIComponent(match[1])
    store.requireSpreadsheet(id)
    const envelope = spreadsheetEnvelope(store, id)
    return {
      status: 200,
      json:
        fields === null ? envelope : applyFieldMask(envelope, parseFieldMask(fields)),
    }
  }

  if ((match = /^\/spreadsheets\/([^/]+)\/values\/(.+)$/.exec(subPath)) !== null) {
    const id = decodeURIComponent(match[1])
    store.requireSpreadsheet(id)
    const rawRange = match[2]

    // A trailing `:verb` from Google's RPC verb set is a values method call;
    // only `clear` is modelled and the rest fail as unmodelled. Anything else
    // after a colon (`Sheet1!A1:B2` sent unencoded — legal, and accepted by
    // real Sheets) is part of the range.
    const verb = /:([A-Za-z][A-Za-z0-9]*)$/.exec(rawRange)
    if (verb !== null && VALUES_VERBS.has(verb[1])) {
      if (verb[1] !== 'clear' || method !== 'POST') throw unhandled(method, url)
      const range = decodeURIComponent(rawRange.slice(0, verb.index))
      const { title, ref } = parseRange(range)
      // Google clears exactly the requested range; open bounds run to the
      // data edge, a bare title clears the whole tab.
      store.clearValues(
        id,
        title,
        ref === null ? undefined : parseRef(ref, range)
      )
      return { status: 200, json: { spreadsheetId: id, clearedRange: range } }
    }

    const range = decodeURIComponent(rawRange)
    const { title, ref } = parseRange(range)
    const rect = parseRef(ref, range)

    if (method === 'GET') {
      const values = readRect(store.getValues(id, title), rect)
      return {
        status: 200,
        json: {
          range,
          majorDimension: 'ROWS',
          ...(values.length > 0 ? { values } : {}),
        },
      }
    }

    if (method === 'PUT') {
      const inputOption = url.searchParams.get('valueInputOption')
      if (inputOption !== 'RAW') {
        throw new StoreError(
          400,
          `google-drive-api-mock: valueInputOption=RAW is required (got ${inputOption ?? 'none'})`
        )
      }
      if (rect.form !== 'cell' && rect.form !== 'rect') {
        throw new StoreError(
          400,
          `google-drive-api-mock: values.update needs a cell or rectangle range (got ${range})`
        )
      }
      const values = cellValues(parseJson(bodyText))
      // A bare cell anchors and expands (real Sheets semantics); a bounded
      // rectangle must contain the payload.
      if (rect.form === 'rect') {
        const fitsRows = values.length <= (rect.row1 as number) - rect.row0 + 1
        const fitsCols = values.every(
          (row) => row.length <= (rect.col1 as number) - rect.col0 + 1
        )
        if (!fitsRows || !fitsCols) {
          throw new StoreError(
            400,
            `google-drive-api-mock: values exceed the requested range ${range}`
          )
        }
      }
      const updatedCells = store.setValuesRect(id, title, rect.row0, rect.col0, values)
      return {
        status: 200,
        json: {
          spreadsheetId: id,
          updatedRange: range,
          updatedRows: values.length,
          updatedColumns: values.reduce((max, row) => Math.max(max, row.length), 0),
          updatedCells,
        },
      }
    }
  }

  throw unhandled(method, url)
}

function unhandled(method: string, url: URL): StoreError {
  return new StoreError(
    404,
    `google-drive-api-mock: unhandled Sheets request ${method} ${url.pathname}${url.search}`
  )
}

function parseJson(bodyText: string): Record<string, unknown> {
  if (bodyText.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new StoreError(400, `Request body is not valid JSON: ${bodyText.slice(0, 80)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new StoreError(400, 'Request body must be a JSON object')
  return parsed as Record<string, unknown>
}
