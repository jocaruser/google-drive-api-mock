#!/usr/bin/env node
// Starts the emulator HTTP server. Configuration via env:
//   PORT (default 8790), GOOGLE_DRIVE_API_MOCK_DATA_DIR (default ./data).
import { createFakeGoogle, createFakeGoogleServer } from '../dist/index.js'

const port = Number(process.env.PORT ?? 8790)
const rootDir = process.env.GOOGLE_DRIVE_API_MOCK_DATA_DIR ?? './data'
const fake = createFakeGoogle({ rootDir })
createFakeGoogleServer(fake).listen(port, () => {
  console.log(`google-drive-api-mock listening on :${port}, data in ${rootDir}`)
})
