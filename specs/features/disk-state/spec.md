# Disk state

The emulator's entire state is plain files under one root directory.
That layout is a public contract:
tests seed a world by writing files before acting,
and verify outcomes by reading files afterwards —
never by stubbing responses.

## The tree

```
<rootDir>/
  _index.json            id → {name, mimeType, parents, trashed},
                         tab list per spreadsheet, id counter
  <folder>/              a Drive folder, at its tree position
    <file>               a regular file's bytes
    <spreadsheet>/       a spreadsheet is a directory…
      <tab>.csv          …one RFC 4180 CSV per tab (LF, trailing newline)
```

Scenarios:

- A file is created without parents
  → its node sits directly under the root (Drive's "My Drive").
- A file is moved between folders
  → its disk node moves with it.
- A consumer writes a tab's CSV directly on disk
  → the next `values` read reflects it
  (values are read from disk, not from memory).
- The emulator is restarted over an existing root
  → the world resumes exactly, driven by `_index.json`.

## Identifiers

Scenarios:

- Files receive deterministic ids (`fake-1`, `fake-2`, …)
  so final-state assertions never chase random values.
- A mounting test supplies an id policy (`assignId`)
  → matching files receive the pinned ids;
  seeded files may set explicit ids directly.
- A pinned or seeded id collides with an existing one → 409.

## Duplicate sibling names

Drive allows two siblings to share a name; a filesystem does not.

Scenarios:

- A rename or copy makes two siblings share a name
  → the API reports both files with the plain `name`,
  while the newcomer's disk node is decorated `<name>~<id>`.
- A later rename, move, or delete frees the plain name
  → the decorated node is renormalised to the plain name,
  so settled trees read cleanly.

## Names the disk cannot hold

File names containing path separators or control characters,
or equal to `.`, `..`, or `_index.json` at the root,
are rejected with 400 rather than approximated.
