import { createFakeGoogle } from './handler.ts'
import { createFakeGoogleServer } from './server.ts'

/**
 * The one process bootstrap, shared by `pnpm start`, the Docker CMD and the
 * published bin. Env: PORT (default 8790; empty/invalid falls back) and
 * GOOGLE_DRIVE_API_MOCK_DATA_DIR (default ./data).
 */
const port = Number(process.env.PORT) || 8790
const rootDir = process.env.GOOGLE_DRIVE_API_MOCK_DATA_DIR ?? './data'
const fake = createFakeGoogle({ rootDir })
createFakeGoogleServer(fake).listen(port, () => {
  console.log(`google-drive-api-mock listening on :${port}, data in ${rootDir}`)
})
