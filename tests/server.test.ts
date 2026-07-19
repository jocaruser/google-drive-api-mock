import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFakeGoogle, type FakeGoogle } from '../src/handler.ts'
import { createFakeGoogleServer } from '../src/server.ts'

let rootDir: string
let fake: FakeGoogle
let server: ReturnType<typeof createFakeGoogleServer>
let base: string

beforeAll(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdam-server-'))
  fake = createFakeGoogle({ rootDir })
  server = createFakeGoogleServer(fake)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(rootDir, { recursive: true, force: true })
})

describe('HTTP server', () => {
  it('answers CORS preflight with 204 and the allow headers', async () => {
    const response = await fetch(`${base}/drive/v3/files`, { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'authorization'
    )
  })

  it('serves a create → list flow over a real socket, with CORS on responses', async () => {
    const created = await fetch(`${base}/drive/v3/files`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'shop',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    })
    expect(created.status).toBe(200)
    expect(created.headers.get('access-control-allow-origin')).toBe('*')
    const { id } = (await created.json()) as { id: string }

    const q = encodeURIComponent(`name='shop' and trashed=false`)
    const list = await fetch(`${base}/drive/v3/files?q=${q}&fields=files(id)`, {
      headers: { Authorization: 'Bearer token' },
    })
    expect(await list.json()).toEqual({ files: [{ id }] })
  })

  it('answers raw HTTP/1.0 requests without a Host header', async () => {
    const { port } = server.address() as AddressInfo
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write('GET /drive/v3/files?q=trashed%3Dfalse HTTP/1.0\r\n\r\n')
      })
      let data = ''
      socket.on('data', (chunk) => {
        data += chunk.toString()
      })
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(raw).toContain('401')
  })

  it('turns handler crashes into 500 responses', async () => {
    const crashing = createFakeGoogleServer({
      store: fake.store,
      handle: () => Promise.reject(new Error('boom')),
    })
    await new Promise<void>((resolve) => crashing.listen(0, resolve))
    const { port } = crashing.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/drive/v3/files`, {
      headers: { Authorization: 'Bearer token' },
    })
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('boom')
    await new Promise((resolve) => crashing.close(resolve))
  })
})
