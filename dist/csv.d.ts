/**
 * RFC 4180 CSV codec for the on-disk sheet tabs. Parse-compatible with
 * `src/Repository/LocalCsv/Csv.ts` (quoted fields, `""` escapes, LF/CRLF
 * input); serialization uses LF so seeded fixtures and asserted output stay
 * diff-friendly. The emulator must not import from `src/`, so the codec is
 * duplicated here and pinned by a compatibility unit test.
 */
export declare function parseCsv(text: string): string[][];
export declare function serializeCsv(matrix: string[][]): string;
