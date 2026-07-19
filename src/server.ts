import * as http from 'node:http'
import type { FakeGoogle } from './handler.ts'

/**
 * HTTP mount: serves all three API prefixes (`/drive/v3`, `/upload/drive/v3`,
 * `/v4`) on one port with permissive CORS, so an app is pointed here simply
 * by swapping its Google base URLs. State lives in the data directory and
 * survives restarts; external writes to it are picked up while serving.
 * Process bootstrap lives in `main.ts`.
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
      // rawHeaders pairs sidestep node's string|string[] folding entirely;
      // Headers.append folds duplicates the standard way.
      const headers = new Headers()
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headers.append(req.rawHeaders[i], req.rawHeaders[i + 1])
      }
      // Node always sets `url` on parsed requests; `host` can be absent on
      // raw HTTP/1.0 requests.
      const url = `http://${req.headers.host ?? 'google-drive-api-mock'}${req.url as string}`
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
