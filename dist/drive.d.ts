import { DriveStore } from './store.ts';
/**
 * Drive v3 subset: files list/get/create/update/copy/delete plus the
 * `uploadType=multipart` create/update. Anything else — clauses, params or
 * paths the real API would accept but this emulator does not model — fails
 * loudly with a 400/404 so tests never pass on silent approximations.
 */
export interface ApiResult {
    status: number;
    json?: unknown;
    text?: string;
    contentType?: string;
}
interface Predicates {
    name?: string;
    parent?: string;
    trashed?: boolean;
    mimeType?: string;
}
/** Parse the app's `q` grammar: conjunctions of the four clause forms. */
export declare function parseQuery(q: string): Predicates;
export declare function handleDrive(store: DriveStore, method: string, url: URL, bodyText: string): ApiResult;
/**
 * `uploadType=multipart`: part 1 is JSON file metadata, part 2 the content.
 * POST creates; PATCH `/files/<id>` replaces content (and name, when given).
 */
export declare function handleUpload(store: DriveStore, method: string, url: URL, bodyText: string, contentTypeHeader: string): ApiResult;
export {};
