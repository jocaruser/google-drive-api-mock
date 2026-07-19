# google-drive-api-mock

Mock Google Drive and Google Sheets in e2e tests
**without adding mock code to your project** —
just change where Google is.
Point your app's Google API base URLs at this server
and it behaves like Drive/Sheets,
except state is plain local files you can seed and inspect.

- **State is files**: a mirrored Drive folder tree,
  one RFC 4180 CSV per sheet tab, one readable JSON index.
  Seed a scenario by writing files; assert by reading them.
  A running server picks up external changes automatically.
- **Fails loudly** outside the modelled surface
  (explicit 400/404, never a silent approximation),
  so a request it cannot answer faithfully turns into a red test.
- **Zero dependencies**; single copy-and-run Docker image;
  0BSD licensed (public-domain-equivalent freedom).

Behaviour is specified in [`specs/features/`](specs/features/README.md),
decisions in [`specs/decisions/`](specs/decisions/README.md).

## Quick start (server mode)

```sh
docker run -p 8790:8790 -v "$PWD/google-data:/data" \
  ghcr.io/jocaruser/google-drive-api-mock:latest
# or, from a checkout: pnpm start        (Node ≥ 22.18, no build step)
```

Then point your app at it instead of Google —
any bearer token is accepted (OAuth is out of scope; keep your auth mock):

| Real base | Mock base |
|---|---|
| `https://www.googleapis.com/drive/v3` | `http://localhost:8790/drive/v3` |
| `https://www.googleapis.com/upload/drive/v3` | `http://localhost:8790/upload/drive/v3` |
| `https://sheets.googleapis.com/v4` | `http://localhost:8790/v4` |

For a Vite app that means three env vars at build/dev time, e.g.
`VITE_GOOGLE_DRIVE_API_BASE=http://localhost:8790/drive/v3` —
your test suite needs no request stubs at all.

In docker compose:

```yaml
services:
  google-mock:
    image: ghcr.io/jocaruser/google-drive-api-mock:latest
    volumes: ["./.google-mock-data:/data"]
    # ports: only if the browser runs outside this network
```

## Seeding and asserting (files are the API)

```
<dataDir>/
  _index.json            id → {name, mimeType, parents, trashed},
                         tab list per spreadsheet, id counter
  <folder>/              a Drive folder
    <file>               a regular file's bytes
    <spreadsheet>/       a spreadsheet is a directory…
      <tab>.csv          …one CSV per tab (LF, trailing newline)
```

Write CSVs/files into the data directory before (or while) the app runs;
delete `_index.json` to reset the world.
The layout is a versioned public contract —
see [`specs/features/disk-state/spec.md`](specs/features/disk-state/spec.md).
Ids are deterministic (`fake-1`, `fake-2`, …),
so final-state assertions never chase random values.

From JS/TS you can also seed programmatically
(`pnpm add -D github:jocaruser/google-drive-api-mock`):

```ts
import { createFakeGoogle, DriveStore } from 'google-drive-api-mock'
// DriveStore on the same data dir seeds a running server;
// createFakeGoogle(...).handle(request) mounts it in-process (no server).
```

## Supported surface — Google Drive API v3

Only what's needed so far (extracted from the illo3d project);
every ❌ request fails loudly with an explicit message.
Contributions extending the surface must extend
the specs and tests in the same change.

| Method | Status | Notes |
|---|---|---|
| files.list | ✅ | `q` conjunctions of `name=`, `'…' in parents`, `trashed=`, `mimeType=`; `fields`, `pageSize` |
| files.get | ✅ | `fields` projection and `alt=media` download (auth-exempt) |
| files.create | ✅ | metadata-only, plus `uploadType=multipart` |
| files.update | ✅ | rename, `addParents`/`removeParents`, multipart content update |
| files.copy | ✅ | files and spreadsheets (tab values included); folders 400 as in real Drive |
| files.delete | ✅ | permanent, cascades to descendants |
| files.download | ❌ | |
| files.emptyTrash | ❌ | trash is not modelled (`trashed` is always false) |
| files.export | ❌ | |
| files.generateCseToken | ❌ | |
| files.generateIds | ❌ | |
| files.listLabels / modifyLabels | ❌ | |
| files.watch | ❌ | |
| about.get | ❌ | |
| accessproposals.get / list / resolve | ❌ | |
| approvals.* (8 methods) | ❌ | |
| apps.get / list | ❌ | |
| changes.getStartPageToken / list / watch | ❌ | |
| channels.stop | ❌ | |
| comments.* (5 methods) | ❌ | |
| drives.* (7 methods) | ❌ | shared drives are not modelled |
| operations.get | ❌ | |
| permissions.* (5 methods) | ❌ | everything is owned by the caller |
| replies.* (5 methods) | ❌ | |
| revisions.* (4 methods) | ❌ | |

## Supported surface — Google Sheets API v4

| Method | Status | Notes |
|---|---|---|
| spreadsheets.create | ✅ | title + initial tabs; lands in the Drive root until moved |
| spreadsheets.get | ✅ | tab properties, `fields` projection, `spreadsheetUrl` |
| spreadsheets.batchUpdate | 🟡 | `addSheet` only; other request types 400 loudly |
| spreadsheets.values.get | ✅ | `'tab'!A:ZZ`, `1:1`, cells, rectangles; Google-style trailing-empty trimming |
| spreadsheets.values.update | ✅ | `valueInputOption=RAW`, rectangle overwrite semantics |
| spreadsheets.values.clear | ✅ | whole-sheet ranges only |
| spreadsheets.values.append | ❌ | |
| spreadsheets.values.batchGet / batchUpdate / batchClear | ❌ | |
| spreadsheets.values.*ByDataFilter (4 methods) | ❌ | |
| spreadsheets.getByDataFilter | ❌ | |
| spreadsheets.developerMetadata.get / search | ❌ | |
| spreadsheets.sheets.copyTo | ❌ | |

Known deliberate relaxations
(specified in [`specs/features/errors-and-auth/spec.md`](specs/features/errors-and-auth/spec.md)):
any bearer token authenticates; `alt=media` needs no token
(image tags cannot send headers);
duplicate sibling names get a `~<id>` disk suffix until renormalised.

## Development

```sh
pnpm install     # dev tooling only — dist/ is committed, not rebuilt on install
pnpm run build   # rebuild dist/ after changing src/ (CI checks it's fresh)
pnpm lint && pnpm typecheck && pnpm coverage   # 100% thresholds
pnpm start       # server straight from sources — no build step
```

This repository is spec-driven: `specs/features/` is canonical behaviour,
`specs/decisions/` records intent, CI enforces lint, types,
100% coverage, dependency audit, a fresh committed `dist/`,
and a building Docker image. See `AGENTS.md` before contributing.

## Licence

[0BSD](LICENSE) — use it for anything, no conditions, no attribution required.
