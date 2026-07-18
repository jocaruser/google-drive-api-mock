/**
 * Public surface of the google-drive-api-mock emulator.
 * Consumers mount `createFakeGoogle` in-process (e.g. behind Playwright's
 * `page.route`) or serve it over HTTP via `createFakeGoogleServer`; the CSV
 * codec is exported so test suites can seed and assert tab files directly.
 */
export { createFakeGoogle } from "./handler.js";
export { createFakeGoogleServer } from "./server.js";
export { DriveStore, StoreError, FOLDER_MIME, SPREADSHEET_MIME, } from "./store.js";
export { parseCsv, serializeCsv } from "./csv.js";
