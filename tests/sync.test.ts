import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeGoogle, type FakeGoogle } from '../src/handler.ts'
import { DriveStore, FOLDER_MIME } from '../src/store.ts'

/**
 * File-based seeding of a RUNNING server: a second store (the test process)
 * writes state into the same data directory, and the serving instance picks
 * it up on the next request — no admin endpoints, files are the API.
 */

let rootDir: string
let serving: FakeGoogle

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdam-sync-'))
  serving = createFakeGoogle({ rootDir })
})

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true })
})

async function list(name: string): Promise<{ id: string }[]> {
  const response = await serving.handle(
    new Request(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `name='${name}'`
      )}&fields=files(id)`,
      { headers: { Authorization: 'Bearer t' } }
    )
  )
  return ((await response.json()) as { files: { id: string }[] }).files
}

describe('external state changes while serving', () => {
  it('sees files seeded by another store instance on the same directory', async () => {
    expect(await list('seeded')).toEqual([])

    const seeder = new DriveStore({ rootDir })
    seeder.createFile({ id: 'ext-1', name: 'seeded', mimeType: FOLDER_MIME })

    expect(await list('seeded')).toEqual([{ id: 'ext-1' }])
  })

  it('treats a deleted index as a reset world', async () => {
    const seeder = new DriveStore({ rootDir })
    seeder.createFile({ id: 'ext-1', name: 'seeded', mimeType: FOLDER_MIME })
    expect(await list('seeded')).toEqual([{ id: 'ext-1' }])

    fs.rmSync(path.join(rootDir, '_index.json'))
    expect(await list('seeded')).toEqual([])
  })

  it('does not reload when the index is untouched (fingerprint match)', async () => {
    const seeder = new DriveStore({ rootDir })
    seeder.createFile({ id: 'ext-1', name: 'seeded', mimeType: FOLDER_MIME })
    expect(await list('seeded')).toEqual([{ id: 'ext-1' }])
    // Second call with no external change exercises the unchanged fast path.
    expect(await list('seeded')).toEqual([{ id: 'ext-1' }])
  })

  it('its own writes do not trigger a self-reload', async () => {
    const create = await serving.handle(
      new Request('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'own', mimeType: FOLDER_MIME }),
      })
    )
    expect(create.status).toBe(200)
    expect(await list('own')).toEqual([{ id: 'fake-1' }])
  })
})
