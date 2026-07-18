# google-drive-api-mock

Disk-backed Google Drive v3 + Sheets v4 emulator.
State is plain files: seed a world by writing them,
exercise your app against the API, assert on the files left behind.
Outside the modelled surface it fails loudly — never approximates.

Born in [illo3d](https://github.com/jocaruser/illo3d)
to replace hand-written response stubs in e2e tests;
extracted so any project can use it.
Behaviour is specified in [`specs/features/`](specs/features/README.md),
intent in [`specs/decisions/`](specs/decisions/README.md).

## Install (as a test dependency)

```sh
pnpm add -D github:jocaruser/google-drive-api-mock
```

Installing from git builds `dist/` automatically (`prepare`).
Zero runtime dependencies; Node ≥ 22.18.

## Use in tests (in-process)

```ts
import { createFakeGoogle } from 'google-drive-api-mock'

const fake = createFakeGoogle({ rootDir: testOutputDir })
// route your app's googleapis.com traffic into fake.handle(request)
// (e.g. Playwright: page.route(matcher, r => fulfil via fake.handle))
// seed:   write files under rootDir before acting
// assert: read files under rootDir afterwards
```

The disk layout — the contract your seeds and asserts rely on —
is specified in [`specs/features/disk-state/spec.md`](specs/features/disk-state/spec.md):

```
<rootDir>/
  _index.json            Drive metadata: ids, parents, MIME types
  <folder>/              a Drive folder
    <file>               a regular file's bytes
    <spreadsheet>/       a spreadsheet is a directory…
      <tab>.csv          …one RFC 4180 CSV per tab
```

## Run as a server (dev mode)

```sh
pnpm exec google-drive-api-mock        # or in a consumer: "google-mock": "google-drive-api-mock"
# PORT=8790 GOOGLE_DRIVE_API_MOCK_DATA_DIR=./data by default
```

Serves `/drive/v3`, `/upload/drive/v3` and `/v4` on one port
with permissive CORS;
point your app at it instead of the real endpoints.
OAuth is not emulated — any `Bearer` token is accepted
(`alt=media` needs none, so image tags work).

There is also a copy-and-run Docker image:

```sh
docker build -t google-drive-api-mock . && docker run -p 8790:8790 -v "$PWD/data:/data" google-drive-api-mock
```

## Modelled surface

Drive v3: `files` list (q-grammar subset) / get (`fields`, `alt=media`) /
create / update (rename, reparent) / copy / delete,
and multipart upload create + content update.
Sheets v4: spreadsheets create/get, `addSheet`,
values get / update (`RAW`) / whole-sheet clear.
Details and scenarios: [`specs/features/`](specs/features/README.md).

## Development

```sh
pnpm install     # dev tooling + builds dist/
pnpm typecheck && pnpm test && pnpm build
pnpm start       # server straight from sources — no build step
```

## Licence

[0BSD](LICENSE) — use it for anything, no conditions, no attribution required.
