import * as http from 'node:http'
import { pathToFileURL } from 'node:url'
import { createFakeGoogle, type FakeGoogle } from './handler.ts'

/**
 * Standalone HTTP mount for dev/demo use: serves all three API prefixes
 * (`/drive/v3`, `/upload/drive/v3`, `/v4`) on one port with permissive CORS,
 * so a browser app pointed here via `VITE_GOOGLE_*_API_BASE` works without a
 * Google account. State persists in the data directory across restarts.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Max-Age': '86400',
}

export function createFakeGoogleServer(fake: FakeGoogle): http.Server {
  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value)
      }
      const url = `http://${req.headers.host ?? 'google-drive-api-mock'}${req.url ?? '/'}`
      const request = new Request(url, {
        method: req.method,
        headers,
        ...(body.length > 0 ? { body } : {}),
      })
      fake
        .handle(request)
        .then(async (response) => {
          const payload = Buffer.from(await response.arrayBuffer())
          const outHeaders: Record<string, string> = { ...CORS_HEADERS }
          response.headers.forEach((value, name) => {
            outHeaders[name] = value
          })
          console.log(`${req.method} ${req.url} -> ${response.status}`)
          res.writeHead(response.status, outHeaders)
          res.end(payload)
        })
        .catch((error: unknown) => {
          console.error(`${req.method} ${req.url} crashed:`, error)
          res.writeHead(500, CORS_HEADERS)
          res.end(String(error))
        })
    })
  })
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const port = Number(process.env.PORT ?? 8790)
  const rootDir = process.env.GOOGLE_DRIVE_API_MOCK_DATA_DIR ?? './data'
  const fake = createFakeGoogle({ rootDir })
  createFakeGoogleServer(fake).listen(port, () => {
    console.log(`google-drive-api-mock listening on :${port}, data in ${rootDir}`)
  })
}
