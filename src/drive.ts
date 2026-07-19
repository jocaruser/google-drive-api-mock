import { applyFieldMask, parseFieldMask } from './fields.ts'
import { DriveStore, FOLDER_MIME, StoreError, type FileMeta } from './store.ts'

/**
 * Drive v3 subset: files list/get/create/update/copy/delete plus the
 * `uploadType=multipart` create/update. Anything else — clauses, params or
 * paths the real API would accept but this emulator does not model — fails
 * loudly with a 400/404 so tests never pass on silent approximations.
 */

export type ApiResult =
  | { status: number; json?: unknown }
  | { status: number; text: string; contentType: string }

interface Predicates {
  name?: string
  parent?: string
  trashed?: boolean
  mimeType?: string
}

/** Parse the app's `q` grammar: conjunctions of the four clause forms. */
export function parseQuery(q: string): Predicates {
  const predicates: Predicates = {}
  for (const clause of splitOnAnd(q)) {
    let match: RegExpExecArray | null
    if ((match = /^name\s*=\s*'(.*)'$/.exec(clause)) !== null) {
      predicates.name = match[1].replace(/\\'/g, "'")
    } else if ((match = /^'(.+)'\s+in\s+parents$/.exec(clause)) !== null) {
      predicates.parent = match[1]
    } else if ((match = /^trashed\s*=\s*(true|false)$/.exec(clause)) !== null) {
      predicates.trashed = match[1] === 'true'
    } else if ((match = /^mimeType\s*=\s*'(.*)'$/.exec(clause)) !== null) {
      predicates.mimeType = match[1]
    } else {
      throw new StoreError(400, `Unsupported q clause for the emulator: ${clause}`)
    }
  }
  return predicates
}

/** Split on ` and ` outside single-quoted strings (`\'` escapes a quote). */
function splitOnAnd(q: string): string[] {
  const clauses: string[] = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < q.length; index++) {
    const char = q[index]
    if (char === '\\' && q[index + 1] === "'") {
      current += "\\'"
      index += 1
      continue
    }
    if (char === "'") inQuotes = !inQuotes
    if (!inQuotes && q.startsWith(' and ', index)) {
      clauses.push(current.trim())
      current = ''
      index += 4
      continue
    }
    current += char
  }
  if (current.trim() !== '') clauses.push(current.trim())
  return clauses
}

function matches(meta: FileMeta, predicates: Predicates): boolean {
  if (predicates.name !== undefined && meta.name !== predicates.name) return false
  if (
    predicates.parent !== undefined &&
    !meta.parents.includes(predicates.parent)
  )
    return false
  if (predicates.trashed !== undefined && meta.trashed !== predicates.trashed)
    return false
  if (predicates.mimeType !== undefined && meta.mimeType !== predicates.mimeType)
    return false
  return true
}

/** Full resource as the emulator models it; `fields` masks project from this. */
function fileResource(meta: FileMeta, origin: string): Record<string, unknown> {
  return {
    kind: 'drive#file',
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    parents: meta.parents,
    trashed: meta.trashed,
    ...(meta.mimeType.startsWith('image/')
      ? {
          // Points back at this emulator: interceptable in route-mount mode,
          // fetchable in server mode. `alt=media` is auth-exempt (see handler).
          thumbnailLink: `${origin}/drive/v3/files/${meta.id}?alt=media`,
        }
      : {}),
  }
}

function project(resource: unknown, fields: string): unknown {
  return applyFieldMask(resource, parseFieldMask(fields))
}

// Google's documented default projection for file resources.
const DEFAULT_FILE_FIELDS = 'kind,id,name,mimeType'

export function handleDrive(
  store: DriveStore,
  method: string,
  url: URL,
  bodyText: string
): ApiResult {
  const subPath = url.pathname.replace(/^\/drive\/v3/, '')
  const fields = url.searchParams.get('fields')

  if (subPath === '/files' && method === 'GET') {
    const q = url.searchParams.get('q')
    const predicates = q === null ? {} : parseQuery(q)
    let found = store.list().filter((meta) => matches(meta, predicates))
    const pageSize = url.searchParams.get('pageSize')
    if (pageSize !== null) found = found.slice(0, Number(pageSize))
    const envelope = {
      kind: 'drive#fileList',
      incompleteSearch: false,
      files: found.map((meta) => fileResource(meta, url.origin)),
    }
    return {
      status: 200,
      json: project(
        envelope,
        fields ?? `kind,incompleteSearch,files(${DEFAULT_FILE_FIELDS})`
      ),
    }
  }

  if (subPath === '/files' && method === 'POST') {
    const body = parseJsonBody(bodyText)
    const name = requireString(body, 'name')
    const meta = store.createFile({
      name,
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : FOLDER_MIME,
      parents: stringArray(body.parents),
    })
    return {
      status: 200,
      json: project(fileResource(meta, url.origin), fields ?? DEFAULT_FILE_FIELDS),
    }
  }

  const copyMatch = /^\/files\/([^/]+)\/copy$/.exec(subPath)
  if (copyMatch !== null && method === 'POST') {
    const body = parseJsonBody(bodyText)
    const source = store.require(decodeURIComponent(copyMatch[1]))
    const meta = store.copy(
      source.id,
      typeof body.name === 'string' ? body.name : `Copy of ${source.name}`,
      body.parents === undefined ? undefined : stringArray(body.parents)
    )
    return {
      status: 200,
      json: project(fileResource(meta, url.origin), fields ?? DEFAULT_FILE_FIELDS),
    }
  }

  const fileMatch = /^\/files\/([^/]+)$/.exec(subPath)
  if (fileMatch !== null) {
    const id = decodeURIComponent(fileMatch[1])
    if (method === 'GET' && url.searchParams.get('alt') === 'media') {
      const meta = store.require(id)
      return {
        status: 200,
        text: store.readContent(id),
        contentType: meta.mimeType,
      }
    }
    if (method === 'GET') {
      const meta = store.require(id)
      return {
        status: 200,
        json: project(fileResource(meta, url.origin), fields ?? DEFAULT_FILE_FIELDS),
      }
    }
    if (method === 'PATCH') {
      const body = parseJsonBody(bodyText)
      let meta = store.require(id)
      if (typeof body.name === 'string') meta = store.rename(id, body.name)
      const addParents = url.searchParams.get('addParents')
      const removeParents = url.searchParams.get('removeParents')
      if (addParents !== null || removeParents !== null) {
        meta = store.reparent(
          id,
          addParents === null ? [] : addParents.split(',').filter((p) => p !== ''),
          removeParents === null
            ? []
            : removeParents.split(',').filter((p) => p !== '')
        )
      }
      return {
        status: 200,
        json: project(fileResource(meta, url.origin), fields ?? DEFAULT_FILE_FIELDS),
      }
    }
    if (method === 'DELETE') {
      store.require(id)
      store.delete(id)
      return { status: 204 }
    }
  }

  throw new StoreError(
    404,
    `google-drive-api-mock: unhandled Drive request ${method} ${url.pathname}${url.search}`
  )
}

/**
 * `uploadType=multipart`: part 1 is JSON file metadata, part 2 the content.
 * POST creates; PATCH `/files/<id>` replaces content (and name, when given).
 */
export function handleUpload(
  store: DriveStore,
  method: string,
  url: URL,
  bodyText: string,
  contentTypeHeader: string
): ApiResult {
  if (url.searchParams.get('uploadType') !== 'multipart') {
    throw new StoreError(
      400,
      `google-drive-api-mock: only uploadType=multipart is supported (got ${url.search})`
    )
  }
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(contentTypeHeader)
  if (boundary === null)
    throw new StoreError(400, 'multipart upload without a boundary')
  const parts = splitMultipart(bodyText, boundary[1] ?? boundary[2])
  if (parts.length < 2)
    throw new StoreError(400, `multipart upload with ${parts.length} part(s)`)
  const metadata = parseJsonBody(parts[0].body)
  const content = parts[1].body
  const contentType = parts[1].contentType

  const subPath = url.pathname.replace(/^\/upload\/drive\/v3/, '')
  if (subPath === '/files' && method === 'POST') {
    const meta = store.createFile({
      name: requireString(metadata, 'name'),
      mimeType:
        typeof metadata.mimeType === 'string'
          ? metadata.mimeType
          : (contentType ?? 'application/octet-stream'),
      parents: stringArray(metadata.parents),
      content,
    })
    return { status: 200, json: { id: meta.id, name: meta.name } }
  }
  const fileMatch = /^\/files\/([^/]+)$/.exec(subPath)
  if (fileMatch !== null && method === 'PATCH') {
    const id = decodeURIComponent(fileMatch[1])
    if (typeof metadata.name === 'string') store.rename(id, metadata.name)
    store.writeContent(id, content)
    const meta = store.require(id)
    return { status: 200, json: { id: meta.id, name: meta.name } }
  }

  throw new StoreError(
    404,
    `google-drive-api-mock: unhandled upload request ${method} ${url.pathname}${url.search}`
  )
}

interface MultipartPart {
  contentType: string | null
  body: string
}

function splitMultipart(bodyText: string, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = []
  for (const raw of bodyText.split(`--${boundary}`)) {
    const chunk = raw.replace(/^\r?\n/, '')
    if (chunk === '' || chunk.startsWith('--')) continue
    const headerEnd = chunk.search(/\r?\n\r?\n/)
    if (headerEnd === -1) continue
    const headerBlock = chunk.slice(0, headerEnd)
    const body = chunk
      .slice(headerEnd)
      .replace(/^\r?\n\r?\n/, '')
      .replace(/\r?\n$/, '')
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerBlock)
    parts.push({ contentType: typeMatch?.[1].trim() ?? null, body })
  }
  return parts
}

function parseJsonBody(bodyText: string): Record<string, unknown> {
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

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string')
    throw new StoreError(400, `Missing required string field '${key}'`)
  return value
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return []
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
    return value
  throw new StoreError(400, 'parents must be an array of strings')
}
