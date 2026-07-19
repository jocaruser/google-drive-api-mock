import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseCsv, serializeCsv } from './csv.ts'

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

export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet'

const INDEX_FILE = '_index.json'

export interface FileMeta {
  id: string
  name: string
  /** Physical basename in the mirrored tree; `name` unless it collided. */
  diskName: string
  mimeType: string
  parents: string[]
  trashed: boolean
}

/** Zero-based inclusive bounds; null runs to the data edge. */
export interface ClearRect {
  row0: number
  col0: number
  row1: number | null
  col1: number | null
}

export interface TabMeta {
  sheetId: number
  title: string
}

interface IndexShape {
  counter: number
  files: Record<string, Omit<FileMeta, 'id'>>
  tabs: Record<string, TabMeta[]>
}

/** `code` maps to the HTTP status the API layer responds with. */
export class StoreError extends Error {
  readonly code: 400 | 404 | 409

  // Assigned explicitly: parameter properties are not erasable syntax, and
  // Node runs these sources directly via type stripping.
  constructor(code: 400 | 404 | 409, message: string) {
    super(message)
    this.code = code
  }
}

export interface CreateFileInput {
  id?: string
  name: string
  mimeType: string
  parents?: string[]
  /** Raw content for regular files; rejected for folders and spreadsheets. */
  content?: string
}

export interface DriveStoreOptions {
  rootDir: string
  /** Optional id policy; return undefined to fall back to `fake-<n>`. */
  assignId?: (file: { name: string; mimeType: string }) => string | undefined
}

export class DriveStore {
  private readonly rootDir: string
  private readonly assignId?: DriveStoreOptions['assignId']
  private counter = 0
  private readonly files = new Map<string, FileMeta>()
  private readonly tabs = new Map<string, TabMeta[]>()
  /** Exact index text backing the in-memory maps (null: no index yet). */
  private indexText: string | null = null

  constructor(options: DriveStoreOptions) {
    this.rootDir = path.resolve(options.rootDir)
    this.assignId = options.assignId
    fs.mkdirSync(this.rootDir, { recursive: true })
    this.loadIndex()
  }

  // ---- index persistence -------------------------------------------------

  /** Raw index text, or null when absent; other read errors stay loud. */
  private readIndexText(): string | null {
    try {
      return fs.readFileSync(path.join(this.rootDir, INDEX_FILE), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private loadIndex(): void {
    this.applyIndexText(this.readIndexText())
  }

  /**
   * Parse-then-commit: a corrupt index must fail loudly on every request
   * (nothing cached, nothing cleared) rather than serve an empty world.
   */
  private applyIndexText(text: string | null): void {
    let parsed: IndexShape | null = null
    if (text !== null) {
      try {
        parsed = JSON.parse(text) as IndexShape
      } catch {
        throw new StoreError(
          400,
          `google-drive-api-mock: ${INDEX_FILE} is not valid JSON — fix or delete it`
        )
      }
    }
    this.files.clear()
    this.tabs.clear()
    this.counter = 0
    this.indexText = text
    if (parsed === null) return
    this.counter = parsed.counter
    for (const [id, meta] of Object.entries(parsed.files)) {
      this.files.set(id, { id, ...meta })
    }
    for (const [id, tabList] of Object.entries(parsed.tabs)) {
      this.tabs.set(id, tabList)
    }
  }

  /**
   * Re-read the index when something else changed it on disk — tests seed
   * and reset a running server purely by writing files (workers are expected
   * to be sequential; concurrent writers are out of scope). Freshness is
   * judged by content, not timestamps: the index is small, and comparing text
   * has no mtime-granularity blind spots. A vanished index means the world
   * was reset. Every public mutator syncs first, so a long-lived seeding
   * store never clobbers state another instance (or the server) wrote.
   */
  sync(): void {
    const current = this.readIndexText()
    if (current === this.indexText) return
    this.applyIndexText(current)
  }

  private saveIndex(): void {
    const shape: IndexShape = { counter: this.counter, files: {}, tabs: {} }
    for (const [id, meta] of this.files) {
      const { id: _id, ...rest } = meta
      shape.files[id] = rest
    }
    for (const [id, tabList] of this.tabs) shape.tabs[id] = tabList
    const text = JSON.stringify(shape, null, 2) + '\n'
    fs.writeFileSync(path.join(this.rootDir, INDEX_FILE), text)
    this.indexText = text
  }

  // ---- path mapping ------------------------------------------------------

  /** Absolute path of a file's node in the mirrored tree. */
  pathOf(id: string): string {
    const meta = this.require(id)
    const segments: string[] = []
    let current: FileMeta | undefined = meta
    const seen = new Set<string>()
    while (current !== undefined) {
      if (seen.has(current.id))
        throw new StoreError(400, `Parent cycle at file ${current.id}`)
      seen.add(current.id)
      segments.unshift(current.diskName)
      const parentId: string | undefined = current.parents[0]
      current = parentId === undefined ? undefined : this.files.get(parentId)
    }
    return path.join(this.rootDir, ...segments)
  }

  /** Same path, relative to the root — for messages and test asserts. */
  relativePathOf(id: string): string {
    return path.relative(this.rootDir, this.pathOf(id))
  }

  private validateName(name: string): void {
    if (
      name === '' ||
      name === '.' ||
      name === '..' ||
      // eslint-disable-next-line no-control-regex
      /[/\\\u0000-\u001f]/.test(name)
    ) {
      throw new StoreError(400, `Unsupported file name for the emulator: '${name}'`)
    }
  }

  /** True when `candidate` is taken as a sibling diskName (or reserved). */
  private diskNameTaken(
    candidate: string,
    parents: string[],
    excludeId: string
  ): boolean {
    if (parents.length === 0 && candidate === INDEX_FILE) return true
    for (const other of this.files.values()) {
      if (other.id === excludeId) continue
      const siblings =
        parents.length === 0
          ? other.parents.length === 0
          : other.parents[0] === parents[0]
      if (siblings && other.diskName === candidate) return true
    }
    return false
  }

  private diskNameFor(meta: Pick<FileMeta, 'id' | 'name' | 'parents'>): string {
    return this.diskNameTaken(meta.name, meta.parents, meta.id)
      ? `${meta.name}~${meta.id}`
      : meta.name
  }

  /**
   * Give every decorated file its plain name back where the collision is gone.
   * A freed name can unlock another file, so iterate to a fixpoint.
   */
  private renormalizeDiskNames(): void {
    let changed = true
    while (changed) {
      changed = false
      for (const meta of this.files.values()) {
        if (meta.diskName === meta.name) continue
        if (this.diskNameTaken(meta.name, meta.parents, meta.id)) continue
        const oldPath = this.pathOf(meta.id)
        meta.diskName = meta.name
        fs.renameSync(oldPath, this.pathOf(meta.id))
        changed = true
      }
    }
  }

  // ---- Drive files -------------------------------------------------------

  get(id: string): FileMeta | undefined {
    return this.files.get(id)
  }

  /** Like `get`, but 404s in Google's wording when the id is unknown. */
  require(id: string): FileMeta {
    const meta = this.files.get(id)
    if (meta === undefined) throw new StoreError(404, `File not found: ${id}.`)
    return meta
  }

  list(): FileMeta[] {
    this.sync()
    return [...this.files.values()]
  }

  createFile(input: CreateFileInput): FileMeta {
    this.sync()
    this.validateName(input.name)
    const parents = input.parents ?? []
    for (const parentId of parents) this.require(parentId)

    const id = input.id ?? this.nextId(input)
    if (this.files.has(id)) throw new StoreError(409, `Duplicate file id: ${id}`)
    const meta: FileMeta = {
      id,
      name: input.name,
      diskName: '',
      mimeType: input.mimeType,
      parents,
      trashed: false,
    }
    meta.diskName = this.diskNameFor(meta)
    this.files.set(id, meta)

    const target = this.pathOf(id)
    if (input.mimeType === FOLDER_MIME || input.mimeType === SPREADSHEET_MIME) {
      if (input.content !== undefined)
        throw new StoreError(400, `${input.mimeType} cannot carry content`)
      fs.mkdirSync(target, { recursive: true })
      if (input.mimeType === SPREADSHEET_MIME) this.tabs.set(id, [])
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, input.content ?? '')
    }
    this.saveIndex()
    return meta
  }

  private nextId(file: { name: string; mimeType: string }): string {
    const assigned = this.assignId?.(file)
    if (assigned !== undefined) return assigned
    this.counter += 1
    return `fake-${this.counter}`
  }

  rename(id: string, newName: string): FileMeta {
    this.sync()
    const meta = this.require(id)
    this.validateName(newName)
    if (newName === meta.name) return meta
    const oldPath = this.pathOf(id)
    meta.name = newName
    meta.diskName = this.diskNameFor(meta)
    fs.renameSync(oldPath, this.pathOf(id))
    this.renormalizeDiskNames()
    this.saveIndex()
    return meta
  }

  reparent(id: string, addParents: string[], removeParents: string[]): FileMeta {
    this.sync()
    const meta = this.require(id)
    for (const parentId of addParents) this.require(parentId)
    const oldPath = this.pathOf(id)
    const next = meta.parents.filter((p) => !removeParents.includes(p))
    for (const parentId of addParents) {
      if (!next.includes(parentId)) next.push(parentId)
    }
    meta.parents = next
    meta.diskName = this.diskNameFor(meta)
    fs.renameSync(oldPath, this.pathOf(id))
    this.renormalizeDiskNames()
    this.saveIndex()
    return meta
  }

  /** Drive can copy files and spreadsheets but not folders — same here. */
  copy(id: string, newName: string, parents?: string[]): FileMeta {
    this.sync()
    const source = this.require(id)
    if (source.mimeType === FOLDER_MIME)
      throw new StoreError(400, 'Folders cannot be copied.')
    this.validateName(newName)
    const targetParents = parents ?? [...source.parents]
    for (const parentId of targetParents) this.require(parentId)
    // Resolved before any mutation so a failure cannot leave a phantom
    // entry; a hand-seeded index may legitimately omit the tabs key.
    const sourceTabs =
      source.mimeType === SPREADSHEET_MIME
        ? (this.tabs.get(id) ?? []).map((tab) => ({ ...tab }))
        : null

    const copied: FileMeta = {
      id: this.nextId({ name: newName, mimeType: source.mimeType }),
      name: newName,
      diskName: '',
      mimeType: source.mimeType,
      parents: targetParents,
      trashed: false,
    }
    copied.diskName = this.diskNameFor(copied)
    this.files.set(copied.id, copied)
    const targetPath = this.pathOf(copied.id)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    if (sourceTabs !== null) {
      this.tabs.set(copied.id, sourceTabs)
      fs.cpSync(this.pathOf(id), targetPath, { recursive: true })
    } else {
      fs.copyFileSync(this.pathOf(id), targetPath)
    }
    this.saveIndex()
    return copied
  }

  delete(id: string): void {
    this.sync()
    const target = this.pathOf(id)
    for (const descendant of this.descendantsOf(id)) {
      this.files.delete(descendant)
      this.tabs.delete(descendant)
    }
    fs.rmSync(target, { recursive: true, force: true })
    this.files.delete(id)
    this.tabs.delete(id)
    this.renormalizeDiskNames()
    this.saveIndex()
  }

  private descendantsOf(id: string): string[] {
    const result: string[] = []
    for (const meta of this.files.values()) {
      if (meta.parents.includes(id)) {
        result.push(meta.id, ...this.descendantsOf(meta.id))
      }
    }
    return result
  }

  readContent(id: string): string {
    const meta = this.require(id)
    if (meta.mimeType === FOLDER_MIME)
      throw new StoreError(400, `Folder ${id} has no downloadable content`)
    if (meta.mimeType === SPREADSHEET_MIME)
      throw new StoreError(
        400,
        `Spreadsheet ${id} must be read through the Sheets API`
      )
    return fs.readFileSync(this.pathOf(id), 'utf8')
  }

  writeContent(id: string, content: string): void {
    this.sync()
    const meta = this.require(id)
    if (meta.mimeType === FOLDER_MIME || meta.mimeType === SPREADSHEET_MIME)
      throw new StoreError(400, `${meta.mimeType} cannot carry content`)
    fs.writeFileSync(this.pathOf(id), content)
  }

  // ---- Sheets tabs -------------------------------------------------------

  /** 404 in Google's wording when the id is not a spreadsheet. */
  requireSpreadsheet(id: string): TabMeta[] {
    const tabList = this.tabs.get(id)
    if (tabList === undefined)
      throw new StoreError(404, 'Requested entity was not found.')
    return tabList
  }

  listTabs(id: string): TabMeta[] {
    this.sync()
    return this.requireSpreadsheet(id).map((tab) => ({ ...tab }))
  }

  addTab(id: string, title: string): TabMeta {
    this.sync()
    const tabList = this.requireSpreadsheet(id)
    this.validateName(title)
    if (tabList.some((tab) => tab.title === title)) {
      throw new StoreError(
        400,
        `A sheet with the name "${title}" already exists. Please enter another name.`
      )
    }
    const tab: TabMeta = {
      sheetId:
        tabList.length === 0 ? 0 : Math.max(...tabList.map((t) => t.sheetId)) + 1,
      title,
    }
    tabList.push(tab)
    fs.writeFileSync(this.tabPath(id, title), '')
    this.saveIndex()
    return tab
  }

  private tabPath(id: string, title: string): string {
    return path.join(this.pathOf(id), `${title}.csv`)
  }

  private requireTab(id: string, title: string): TabMeta {
    const tab = this.requireSpreadsheet(id).find((t) => t.title === title)
    if (tab === undefined)
      throw new StoreError(400, `Unable to parse range: '${title}'`)
    return tab
  }

  getValues(id: string, title: string): string[][] {
    this.sync()
    this.requireTab(id, title)
    const tabPath = this.tabPath(id, title)
    if (!fs.existsSync(tabPath)) return []
    return parseCsv(fs.readFileSync(tabPath, 'utf8'))
  }

  /** Rectangle overwrite at (row0, col0), Sheets `values.update` semantics. */
  setValuesRect(
    id: string,
    title: string,
    row0: number,
    col0: number,
    values: string[][]
  ): number {
    this.sync()
    this.requireTab(id, title)
    const matrix = this.getValues(id, title)
    let written = 0
    values.forEach((row, r) => {
      const rowIndex = row0 + r
      while (matrix.length <= rowIndex) matrix.push([])
      const target = matrix[rowIndex]
      row.forEach((cell, c) => {
        const colIndex = col0 + c
        while (target.length <= colIndex) target.push('')
        target[colIndex] = cell
        written += 1
      })
    })
    fs.writeFileSync(this.tabPath(id, title), serializeCsv(matrix))
    return written
  }

  /**
   * Blank every cell in the rect (Google `values.clear` semantics: exactly
   * the requested range, open-ended bounds run to the data edge). No rect
   * clears the whole tab.
   */
  clearValues(id: string, title: string, rect?: ClearRect): void {
    this.sync()
    this.requireTab(id, title)
    if (rect === undefined) {
      fs.writeFileSync(this.tabPath(id, title), '')
      return
    }
    const matrix = this.getValues(id, title)
    const rowEnd = rect.row1 === null ? matrix.length - 1 : rect.row1
    for (let r = rect.row0; r <= rowEnd && r < matrix.length; r++) {
      const row = matrix[r]
      const colEnd = rect.col1 === null ? row.length - 1 : rect.col1
      for (let c = rect.col0; c <= colEnd && c < row.length; c++) row[c] = ''
    }
    while (matrix.length > 0 && matrix[matrix.length - 1].every((cell) => cell === ''))
      matrix.pop()
    fs.writeFileSync(this.tabPath(id, title), serializeCsv(matrix))
  }
}
