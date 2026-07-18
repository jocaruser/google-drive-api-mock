/**
 * RFC 4180 CSV codec for the on-disk sheet tabs. Parse-compatible with
 * `src/Repository/LocalCsv/Csv.ts` (quoted fields, `""` escapes, LF/CRLF
 * input); serialization uses LF so seeded fixtures and asserted output stay
 * diff-friendly. The emulator must not import from `src/`, so the codec is
 * duplicated here and pinned by a compatibility unit test.
 */
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (inQuotes) {
            if (char !== '"') {
                cell += char;
            }
            else if (text[index + 1] === '"') {
                cell += '"';
                index++;
            }
            else {
                inQuotes = false;
            }
        }
        else if (char === '"') {
            inQuotes = true;
        }
        else if (char === ',') {
            row.push(cell);
            cell = '';
        }
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[index + 1] === '\n')
                index++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        }
        else {
            cell += char;
        }
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
export function serializeCsv(matrix) {
    if (matrix.length === 0)
        return '';
    return matrix.map((row) => row.map(serializeCell).join(',')).join('\n') + '\n';
}
function serializeCell(cell) {
    if (!/[",\r\n]/.test(cell))
        return cell;
    return `"${cell.replace(/"/g, '""')}"`;
}
