import { handleDrive, handleUpload } from "./drive.js";
import { handleSheets } from "./sheets.js";
import { DriveStore, StoreError } from "./store.js";
/**
 * One row per raisable code: `status` is the modern RPC status both APIs
 * carry; `reason` feeds Drive's legacy `errors[]` entries. Extending the
 * emulator with a new code is a single row here — the keyed Record makes a
 * missing column a compile error.
 */
const ERROR_CATALOGUE = {
    400: { status: 'INVALID_ARGUMENT', reason: 'badRequest' },
    401: { status: 'UNAUTHENTICATED', reason: 'authError' },
    404: { status: 'NOT_FOUND', reason: 'notFound' },
    409: { status: 'ALREADY_EXISTS', reason: 'duplicate' },
};
function errorResponse(code, message, api) {
    const { status, reason } = ERROR_CATALOGUE[code];
    if (api === 'sheets') {
        return jsonResponse(code, { error: { code, message, status } });
    }
    return jsonResponse(code, {
        error: {
            code,
            message,
            errors: [
                {
                    message,
                    domain: 'global',
                    reason,
                    ...(code === 401
                        ? { location: 'Authorization', locationType: 'header' }
                        : {}),
                },
            ],
            status,
        },
    });
}
function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}
function toResponse(result) {
    if ('text' in result) {
        return new Response(result.text, {
            status: result.status,
            headers: { 'Content-Type': result.contentType },
        });
    }
    if (result.json !== undefined)
        return jsonResponse(result.status, result.json);
    return new Response(null, { status: result.status });
}
export function createFakeGoogle(options) {
    const store = new DriveStore(options);
    async function handle(request) {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();
        const api = url.pathname.startsWith('/v4') ? 'sheets' : 'drive';
        const mediaDownload = method === 'GET' && url.searchParams.get('alt') === 'media';
        const authorization = request.headers.get('authorization') ?? '';
        if (!mediaDownload && !authorization.startsWith('Bearer ')) {
            return errorResponse(401, 'Request had invalid authentication credentials. Expected OAuth 2 access token.', api);
        }
        const bodyText = method === 'GET' || method === 'HEAD' ? '' : await request.text();
        try {
            // State may have been seeded or reset on disk while serving (the whole
            // point of file-based seeding) — pick up external index changes first.
            // Inside the try so a corrupt index answers as a loud Google-shaped 400.
            store.sync();
            if (url.pathname.startsWith('/upload/drive/v3')) {
                return toResponse(handleUpload(store, method, url, bodyText, request.headers.get('content-type') ?? ''));
            }
            if (url.pathname.startsWith('/drive/v3')) {
                return toResponse(handleDrive(store, method, url, bodyText));
            }
            if (url.pathname.startsWith('/v4')) {
                return toResponse(handleSheets(store, method, url, bodyText));
            }
            return errorResponse(404, `google-drive-api-mock: unhandled path ${url.pathname} (expected /drive/v3, /upload/drive/v3 or /v4)`, api);
        }
        catch (error) {
            if (error instanceof StoreError)
                return errorResponse(error.code, error.message, api);
            throw error;
        }
    }
    return { store, handle };
}
