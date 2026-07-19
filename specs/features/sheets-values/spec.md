# Sheets values

The emulator answers the Google Sheets v4 surface
for spreadsheets held in its disk store;
each tab's values live in one CSV file
(see [disk-state](../disk-state/spec.md)).

## Spreadsheets and tabs

Scenarios:

- `POST /v4/spreadsheets` with a title and initial sheet titles
  → a spreadsheet exists (parented at the root until moved via Drive),
  one tab per requested title, `sheetId`s assigned deterministically;
  the envelope carries a `spreadsheetUrl`
  (`https://docs.google.com/spreadsheets/d/{id}/edit`).
- `GET /v4/spreadsheets/{id}?fields=sheets.properties.title`
  → the tab titles in order
  (without `fields`, the full envelope including `spreadsheetUrl`).
- `POST …:batchUpdate` with an `addSheet` request
  → the tab is added and its properties returned.
- `addSheet` for a title that already exists
  → 400 whose message contains `already exists`
  (consumers branch on that wording, as with real Sheets).
- Any other `batchUpdate` request type
  → 400 naming the unsupported request.
- The spreadsheet id is unknown
  → 404 `Requested entity was not found.`

## Reading values (`GET …/values/{range}`)

Ranges name a tab (quoted or bare) and optionally a reference:
`'tab'!A:ZZ`, `'tab'!1:1`, `'tab'!A1`, or rectangle forms.

Scenarios:

- The range holds values
  → `values` as rows of strings,
  with trailing empty rows and trailing empty cells trimmed,
  exactly as Google trims them.
- The range holds nothing → the `values` key is absent entirely.
- The tab does not exist → 400 `Unable to parse range: …`.

## Writing values (`PUT …/values/{range}`)

Scenarios:

- `valueInputOption=RAW` with a start cell (for example `'tab'!A1`)
  → the payload overwrites exactly the rectangle it covers,
  leaving cells outside it untouched
  (a header rewrite must not clobber data rows);
  the response reports `updatedRows`, `updatedColumns`
  and `updatedCells`.
- `valueInputOption` missing or not `RAW` → 400.

## Clearing (`POST …/values/{range}:clear`)

Scenarios:

- Any range → exactly the cells it covers are blanked,
  as in real Sheets: `'tab'!A:ZZ` or a bare title clears the tab,
  `'tab'!A:B` clears only those columns,
  `'tab'!A1` clears one cell; the tab itself always remains.
- A trailing `:verb` other than `clear`
  (for example `:append`) → 404 as an unmodelled method;
  a colon inside an unencoded range (`tab!A1:B2`)
  is part of the range, never a verb.
