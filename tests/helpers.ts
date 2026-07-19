import type { FakeGoogle } from '../src/handler.ts'

/**
 * One request helper for every suite: merges headers over a default bearer
 * token and stringifies object bodies — the four ad-hoc copies this replaces
 * had silently divergent semantics.
 */

export const DRIVE = 'https://www.googleapis.com/drive/v3'
export const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const SHEETS = 'https://sheets.googleapis.com/v4'

export interface CallResult {
  status: number
  text: string
  json: () => unknown
}

export type Call = (
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>
) => Promise<CallResult>

export function bindCall(getFake: () => FakeGoogle): Call {
  return async (method, url, body, headers = {}) => {
    const init: RequestInit = {
      method,
      headers: { Authorization: 'Bearer test-token', ...headers },
    }
    if (body !== undefined) {
      init.body =
        typeof body === 'string' || body instanceof Uint8Array
          ? body
          : JSON.stringify(body)
    }
    const response = await getFake().handle(new Request(url, init))
    const text = await response.text()
    return { status: response.status, text, json: () => JSON.parse(text) }
  }
}

export interface MultipartOptions {
  boundary?: string
  /** Content-Type of the second (content) part; null omits the header. */
  contentType?: string | null
  /** Quote the boundary parameter in the request Content-Type header. */
  quoteBoundary?: boolean
}

/** Build a Drive multipart body plus its request Content-Type header. */
export function multipartBody(
  metadata: unknown,
  content: string,
  options: MultipartOptions = {}
): { body: string; header: string } {
  const boundary = options.boundary ?? 'b'
  const contentType =
    options.contentType === undefined ? 'application/json' : options.contentType
  const lines = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    ...(contentType === null ? ['X-No-Content-Type: yes'] : [`Content-Type: ${contentType}`]),
    '',
    content,
    `--${boundary}--`,
  ]
  const boundaryParam = options.quoteBoundary === true ? `"${boundary}"` : boundary
  return {
    body: lines.join('\r\n'),
    header: `multipart/related; boundary=${boundaryParam}`,
  }
}

/** Create a spreadsheet with the given tab titles; returns its id. */
export async function makeSheet(
  call: Call,
  titles: string[] = ['t']
): Promise<string> {
  const created = await call(`POST`, `${SHEETS}/spreadsheets`, {
    sheets: titles.map((title) => ({ properties: { title } })),
  })
  return (created.json() as { spreadsheetId: string }).spreadsheetId
}
