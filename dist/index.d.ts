/**
 * Public surface of the google-drive-api-mock emulator.
 * Consumers mount `createFakeGoogle` in-process (e.g. behind Playwright's
 * `page.route`) or serve it over HTTP via `createFakeGoogleServer`; the CSV
 * codec is exported so test suites can seed and assert tab files directly.
 */
export { createFakeGoogle, type FakeGoogle } from './handler.ts';
export { createFakeGoogleServer } from './server.ts';
export { DriveStore, StoreError, FOLDER_MIME, SPREADSHEET_MIME, } from './store.ts';
export type { CreateFileInput, DriveStoreOptions, FileMeta, TabMeta, } from './store.ts';
export { parseCsv, serializeCsv } from './csv.ts';
