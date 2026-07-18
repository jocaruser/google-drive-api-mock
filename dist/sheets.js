import { applyFieldMask, parseFieldMask } from "./fields.js";
import { SPREADSHEET_MIME, StoreError } from "./store.js";
function parseRange(range) {
    const quoted = /^'((?:[^']|'')*)'(?:!(.+))?$/.exec(range);
    if (quoted !== null) {
        return { title: quoted[1].replace(/''/g, "'"), ref: quoted[2] ?? null };
    }
    const plain = /^([^!]+)(?:!(.+))?$/.exec(range);
    if (plain !== null)
        return { title: plain[1], ref: plain[2] ?? null };
    throw new StoreError(400, `Unable to parse range: ${range}`);
}
/** `A` → 0, `Z` → 25, `AA` → 26 … */
function columnIndex(letters) {
    let value = 0;
    for (const char of letters)
        value = value * 26 + (char.charCodeAt(0) - 64);
    return value - 1;
}
function parseRef(ref, range) {
    if (ref === null)
        return { row0: 0, col0: 0, row1: null, col1: null };
    let match;
    if ((match = /^([A-Z]+):([A-Z]+)$/.exec(ref)) !== null) {
        return {
            row0: 0,
            col0: columnIndex(match[1]),
            row1: null,
            col1: columnIndex(match[2]),
        };
    }
    if ((match = /^(\d+):(\d+)$/.exec(ref)) !== null) {
        return {
            row0: Number(match[1]) - 1,
            col0: 0,
            row1: Number(match[2]) - 1,
            col1: null,
        };
    }
    if ((match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref)) !== null) {
        return {
            row0: Number(match[2]) - 1,
            col0: columnIndex(match[1]),
            row1: Number(match[4]) - 1,
            col1: columnIndex(match[3]),
        };
    }
    if ((match = /^([A-Z]+)(\d+)$/.exec(ref)) !== null) {
        return {
            row0: Number(match[2]) - 1,
            col0: columnIndex(match[1]),
            row1: null,
            col1: null,
        };
    }
    throw new StoreError(400, `Unable to parse range: ${range}`);
}
/** Slice `matrix` to the rect, then trim trailing empty rows and cells. */
function readRect(matrix, rect) {
    const rows = matrix.slice(rect.row0, rect.row1 === null ? undefined : rect.row1 + 1);
    const sliced = rows.map((row) => row.slice(rect.col0, rect.col1 === null ? undefined : rect.col1 + 1));
    const trimmed = sliced.map((row) => {
        const copy = [...row];
        while (copy.length > 0 && copy[copy.length - 1] === '')
            copy.pop();
        return copy;
    });
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0)
        trimmed.pop();
    return trimmed;
}
function spreadsheetEnvelope(store, id) {
    const meta = store.require(id);
    return {
        spreadsheetId: id,
        properties: { title: meta.name },
        sheets: store.listTabs(id).map((tab, index) => ({
            properties: { sheetId: tab.sheetId, title: tab.title, index },
        })),
    };
}
function cellValues(body) {
    const values = body.values;
    if (values === undefined)
        return [];
    if (!Array.isArray(values) || values.some((row) => !Array.isArray(row)))
        throw new StoreError(400, 'values must be an array of rows');
    return values.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
}
export function handleSheets(store, method, url, bodyText) {
    const subPath = url.pathname.replace(/^\/v4/, '');
    const fields = url.searchParams.get('fields');
    if (subPath === '/spreadsheets' && method === 'POST') {
        const body = parseJson(bodyText);
        const properties = (body.properties ?? {});
        const title = typeof properties.title === 'string' ? properties.title : 'Untitled spreadsheet';
        const meta = store.createFile({ name: title, mimeType: SPREADSHEET_MIME });
        const sheets = Array.isArray(body.sheets) ? body.sheets : [];
        for (const sheet of sheets) {
            const tabTitle = sheet.properties?.title;
            if (typeof tabTitle !== 'string')
                throw new StoreError(400, 'sheets[].properties.title must be a string');
            store.addTab(meta.id, tabTitle);
        }
        return { status: 200, json: spreadsheetEnvelope(store, meta.id) };
    }
    let match;
    if ((match = /^\/spreadsheets\/([^/:]+):batchUpdate$/.exec(subPath)) !== null) {
        if (method !== 'POST')
            throw unhandled(method, url);
        const id = decodeURIComponent(match[1]);
        store.requireSpreadsheet(id);
        const body = parseJson(bodyText);
        const requests = Array.isArray(body.requests) ? body.requests : [];
        const replies = [];
        for (const request of requests) {
            const keys = Object.keys(request);
            if (keys.length === 1 && keys[0] === 'addSheet') {
                const addSheet = request.addSheet;
                const title = addSheet.properties?.title;
                if (typeof title !== 'string')
                    throw new StoreError(400, 'addSheet.properties.title must be a string');
                const tab = store.addTab(id, title);
                replies.push({
                    addSheet: { properties: { sheetId: tab.sheetId, title: tab.title } },
                });
            }
            else {
                throw new StoreError(400, `google-drive-api-mock: unsupported batchUpdate request: ${keys.join(',')}`);
            }
        }
        return { status: 200, json: { spreadsheetId: id, replies } };
    }
    if ((match = /^\/spreadsheets\/([^/:]+)$/.exec(subPath)) !== null) {
        if (method !== 'GET')
            throw unhandled(method, url);
        const id = decodeURIComponent(match[1]);
        store.requireSpreadsheet(id);
        const envelope = spreadsheetEnvelope(store, id);
        return {
            status: 200,
            json: fields === null ? envelope : applyFieldMask(envelope, parseFieldMask(fields)),
        };
    }
    if ((match = /^\/spreadsheets\/([^/]+)\/values\/(.+)$/.exec(subPath)) !== null) {
        const id = decodeURIComponent(match[1]);
        store.requireSpreadsheet(id);
        const rawRange = match[2];
        if (rawRange.endsWith(':clear')) {
            if (method !== 'POST')
                throw unhandled(method, url);
            const range = decodeURIComponent(rawRange.slice(0, -':clear'.length));
            const { title, ref } = parseRange(range);
            const rect = parseRef(ref, range);
            if (rect.row0 !== 0 || rect.col0 !== 0 || rect.row1 !== null) {
                throw new StoreError(400, `google-drive-api-mock: only whole-sheet clears are supported (got ${range})`);
            }
            store.clearValues(id, title);
            return { status: 200, json: { spreadsheetId: id, clearedRange: range } };
        }
        const range = decodeURIComponent(rawRange);
        const { title, ref } = parseRange(range);
        const rect = parseRef(ref, range);
        if (method === 'GET') {
            const values = readRect(store.getValues(id, title), rect);
            return {
                status: 200,
                json: {
                    range,
                    majorDimension: 'ROWS',
                    ...(values.length > 0 ? { values } : {}),
                },
            };
        }
        if (method === 'PUT') {
            const inputOption = url.searchParams.get('valueInputOption');
            if (inputOption !== 'RAW') {
                throw new StoreError(400, `google-drive-api-mock: valueInputOption=RAW is required (got ${inputOption ?? 'none'})`);
            }
            if (rect.row1 !== null || rect.col1 !== null || ref === null) {
                throw new StoreError(400, `google-drive-api-mock: values.update needs a start cell like A1 (got ${range})`);
            }
            const values = cellValues(parseJson(bodyText));
            const updatedCells = store.setValuesRect(id, title, rect.row0, rect.col0, values);
            return {
                status: 200,
                json: {
                    spreadsheetId: id,
                    updatedRange: range,
                    updatedRows: values.length,
                    updatedCells,
                },
            };
        }
    }
    throw unhandled(method, url);
}
function unhandled(method, url) {
    return new StoreError(404, `google-drive-api-mock: unhandled Sheets request ${method} ${url.pathname}${url.search}`);
}
function parseJson(bodyText) {
    if (bodyText.trim() === '')
        return {};
    let parsed;
    try {
        parsed = JSON.parse(bodyText);
    }
    catch {
        throw new StoreError(400, `Request body is not valid JSON: ${bodyText.slice(0, 80)}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new StoreError(400, 'Request body must be a JSON object');
    return parsed;
}
