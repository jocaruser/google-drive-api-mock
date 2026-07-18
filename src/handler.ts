import { handleDrive, handleUpload, type ApiResult } from './drive.ts'
import { handleSheets } from './sheets.ts'
import { DriveStore, StoreError, type DriveStoreOptions } from './store.ts'

/**
 * Fetch-level entry point: one web-standard `Request` in, one `Response` out.
 * Transport-agnostic on purpose — Playwright mounts it behind `page.route`,
 * `server.ts` behind a real HTTP listener, and unit tests call it directly.
 *
 * Every request needs a `Bearer` token except `GET …?alt=media`: the app loads
 * image thumbnails through plain `<img src>` (no Authorization header), which
 * real Drive serves via signed lh3 URLs the emulator does not model.
 */

const STATUS_NAMES: Record<number, string> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  404: 'NOT_FOUND',
  409: 'ALREADY_EXISTS',
  500: 'INTERNAL',
}

function errorResponse(code: number, message: string): Response {
  return jsonResponse(code, {
    error: { code, message, status: STATUS_NAMES[code] ?? 'UNKNOWN' },
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function toResponse(result: ApiResult): Response {
  if (result.text !== undefined) {
    return new Response(result.text, {
      status: result.status,
      headers: { 'Content-Type': result.contentType ?? 'text/plain' },
    })
  }
  if (result.json !== undefined) return jsonResponse(result.status, result.json)
  return new Response(null, { status: result.status })
}

export interface FakeGoogle {
  store: DriveStore
  handle(request: Request): Promise<Response>
}

export function createFakeGoogle(options: DriveStoreOptions): FakeGoogle {
  const store = new DriveStore(options)

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    const mediaDownload =
      method === 'GET' && url.searchParams.get('alt') === 'media'
    const authorization = request.headers.get('authorization') ?? ''
    if (!mediaDownload && !authorization.startsWith('Bearer ')) {
      return errorResponse(
        401,
        'Request had invalid authentication credentials. Expected OAuth 2 access token.'
      )
    }

    const bodyText =
      method === 'GET' || method === 'HEAD' ? '' : await request.text()

    try {
      if (url.pathname.startsWith('/upload/drive/v3')) {
        return toResponse(
          handleUpload(
            store,
            method,
            url,
            bodyText,
            request.headers.get('content-type') ?? ''
          )
        )
      }
      if (url.pathname.startsWith('/drive/v3')) {
        return toResponse(handleDrive(store, method, url, bodyText))
      }
      if (url.pathname.startsWith('/v4')) {
        return toResponse(handleSheets(store, method, url, bodyText))
      }
      return errorResponse(
        404,
        `google-drive-api-mock: unhandled path ${url.pathname} (expected /drive/v3, /upload/drive/v3 or /v4)`
      )
    } catch (error) {
      if (error instanceof StoreError)
        return errorResponse(error.code, error.message)
      throw error
    }
  }

  return { store, handle }
}
