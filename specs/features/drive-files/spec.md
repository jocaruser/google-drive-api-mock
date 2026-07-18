# Drive files

The emulator answers the Google Drive v3 file surface
for files it holds in its disk store.
Consumers talk to it exactly as they would talk to
`https://www.googleapis.com/drive/v3`;
only the base URL differs.

## Listing (`GET /drive/v3/files`)

A `q` filter is a conjunction of these clause forms,
in any order, joined by ` and `:

- `name='…'` (a `\'` escapes a quote inside the value),
- `'…' in parents`,
- `trashed=true|false`,
- `mimeType='…'`.

Scenarios:

- All clauses match a stored file
  → the file appears in `files`, in creation order.
- The parent id in the query does not exist
  → an empty `files` list (not an error).
- A clause form outside the grammar is sent
  → 400 naming the unsupported clause
  (see [errors-and-auth](../errors-and-auth/spec.md)).
- `pageSize=n` is given → at most `n` results.
- A `fields` mask such as `files(id,thumbnailLink)` is given
  → each entry carries exactly the requested fields,
  omitting those with no value.

## Reading

Scenarios:

- `GET /files/{id}?fields=…` → the metadata projection.
- `GET /files/{id}?alt=media` → the file's bytes
  with its stored MIME type (no authentication required;
  see [errors-and-auth](../errors-and-auth/spec.md)).
- The id is unknown → 404 `File not found: {id}.`

## Creating, renaming, moving

Scenarios:

- `POST /files` with `name` and a folder MIME type
  → a folder exists at the tree position given by `parents`.
- `PATCH /files/{id}` with `{"name": …}` → the file is renamed.
- `PATCH /files/{id}?addParents=…&removeParents=…`
  → the file moves; its content moves with it on disk.
- A multipart upload (`uploadType=multipart`)
  carries file metadata as part one and content as part two:
  `POST /upload/drive/v3/files` creates,
  `PATCH /upload/drive/v3/files/{id}` replaces content
  (and name, when the metadata part carries one).

## Copying and deleting

Scenarios:

- `POST /files/{id}/copy` with a name (and optional `parents`)
  → an independent copy with a fresh id;
  copying a spreadsheet copies every tab's values.
- Copying a folder is requested → 400, as in real Drive.
- `DELETE /files/{id}` → 204;
  the file, its disk node, and every descendant are gone permanently.

## Duplicate names

Two siblings may hold the same `name` at the same time,
exactly as in real Drive —
consumers performing atomic-rename dances rely on it.
How the disk tree represents the collision is specified in
[disk-state](../disk-state/spec.md).

## Thumbnails

An image file's `thumbnailLink` points back at the emulator's own
`alt=media` URL for that file,
so an `<img src>` renders it without credentials.
