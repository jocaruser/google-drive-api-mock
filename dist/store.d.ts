/**
 * Disk-backed Drive/Sheets state. The on-disk layout is a contract for tests
 * (seed files in, assert files out) and mirrors the Drive folder tree:
 *
 *   <rootDir>/
 *     _index.json            id → {name, mimeType, parents, trashed}, tab list per
 *                            spreadsheet, and the id counter (pretty-printed JSON)
 *     <folder>/              a Drive folder (its name, at its tree position)
 *       <file>               a regular file's bytes, e.g. illo3d.metadata.json
 *       <spreadsheet>/       a spreadsheet is a directory…
 *         <tab>.csv          …with one RFC 4180 CSV per tab (LF, trailing newline)
 *
 * Files with no parent sit directly under <rootDir> (Drive's "My Drive").
 *
 * Drive allows sibling files to share a name (the migration flow briefly holds
 * two `illo3d-data` spreadsheets during its atomic-rename dance); a filesystem
 * does not. Each file therefore carries a `diskName`: equal to `name` while
 * unique among siblings, decorated to `<name>~<id>` while colliding, and
 * renormalized back to the plain name as soon as a rename/move/delete frees
 * it — so settled trees stay human-readable.
 *
 * Ids are deterministic (`fake-<n>`), overridable per file via `assignId` so
 * tests can pin well-known ids.
 */
export declare const FOLDER_MIME = "application/vnd.google-apps.folder";
export declare const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
export interface FileMeta {
    id: string;
    name: string;
    /** Physical basename in the mirrored tree; `name` unless it collided. */
    diskName: string;
    mimeType: string;
    parents: string[];
    trashed: boolean;
}
/** Zero-based inclusive bounds; null runs to the data edge. */
export interface ClearRect {
    row0: number;
    col0: number;
    row1: number | null;
    col1: number | null;
}
export interface TabMeta {
    sheetId: number;
    title: string;
}
/** `code` maps to the HTTP status the API layer responds with. */
export declare class StoreError extends Error {
    readonly code: 400 | 404 | 409;
    constructor(code: 400 | 404 | 409, message: string);
}
export interface CreateFileInput {
    id?: string;
    name: string;
    mimeType: string;
    parents?: string[];
    /** Raw content for regular files; rejected for folders and spreadsheets. */
    content?: string;
}
export interface DriveStoreOptions {
    rootDir: string;
    /** Optional id policy; return undefined to fall back to `fake-<n>`. */
    assignId?: (file: {
        name: string;
        mimeType: string;
    }) => string | undefined;
}
export declare class DriveStore {
    private readonly rootDir;
    private readonly assignId?;
    private counter;
    private readonly files;
    private readonly tabs;
    /** Exact index text backing the in-memory maps (null: no index yet). */
    private indexText;
    constructor(options: DriveStoreOptions);
    /** Raw index text, or null when absent; other read errors stay loud. */
    private readIndexText;
    private loadIndex;
    /**
     * Parse-then-commit: a corrupt index must fail loudly on every request
     * (nothing cached, nothing cleared) rather than serve an empty world.
     */
    private applyIndexText;
    /**
     * Re-read the index when something else changed it on disk — tests seed
     * and reset a running server purely by writing files (workers are expected
     * to be sequential; concurrent writers are out of scope). Freshness is
     * judged by content, not timestamps: the index is small, and comparing text
     * has no mtime-granularity blind spots. A vanished index means the world
     * was reset. Every public mutator syncs first, so a long-lived seeding
     * store never clobbers state another instance (or the server) wrote.
     */
    sync(): void;
    private saveIndex;
    /** Absolute path of a file's node in the mirrored tree. */
    pathOf(id: string): string;
    /** Same path, relative to the root — for messages and test asserts. */
    relativePathOf(id: string): string;
    private validateName;
    /** True when `candidate` is taken as a sibling diskName (or reserved). */
    private diskNameTaken;
    private diskNameFor;
    /**
     * Give every decorated file its plain name back where the collision is gone.
     * A freed name can unlock another file, so iterate to a fixpoint.
     */
    private renormalizeDiskNames;
    get(id: string): FileMeta | undefined;
    /** Like `get`, but 404s in Google's wording when the id is unknown. */
    require(id: string): FileMeta;
    list(): FileMeta[];
    createFile(input: CreateFileInput): FileMeta;
    private nextId;
    rename(id: string, newName: string): FileMeta;
    reparent(id: string, addParents: string[], removeParents: string[]): FileMeta;
    /** Drive can copy files and spreadsheets but not folders — same here. */
    copy(id: string, newName: string, parents?: string[]): FileMeta;
    delete(id: string): void;
    private descendantsOf;
    readContent(id: string): string;
    writeContent(id: string, content: string): void;
    /** 404 in Google's wording when the id is not a spreadsheet. */
    requireSpreadsheet(id: string): TabMeta[];
    listTabs(id: string): TabMeta[];
    addTab(id: string, title: string): TabMeta;
    private tabPath;
    private requireTab;
    getValues(id: string, title: string): string[][];
    /** Rectangle overwrite at (row0, col0), Sheets `values.update` semantics. */
    setValuesRect(id: string, title: string, row0: number, col0: number, values: string[][]): number;
    /**
     * Blank every cell in the rect (Google `values.clear` semantics: exactly
     * the requested range, open-ended bounds run to the data edge). No rect
     * clears the whole tab.
     */
    clearValues(id: string, title: string, rect?: ClearRect): void;
}
