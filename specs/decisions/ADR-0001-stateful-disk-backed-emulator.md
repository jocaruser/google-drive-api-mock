# ADR-0001: A stateful, disk-backed emulator — not response stubs

- Status: Draft
- Date: 2026-07-19

## Context

This project was extracted from illo3d,
whose Google Drive backend was tested through per-endpoint
Playwright response stubs.
Stubs encode guesses about how Google behaves;
the guesses drift, and stateful flows
(create → list → read, atomic-rename dances)
cannot be expressed at all.

Alternatives evaluated before building one (2026-07-19):

- `pubkey/google-drive-mock`
  (npm, ~5k weekly downloads, published June 2026) —
  the closest candidate: an active TypeScript mock server,
  but explicitly scoped to testing RxDB's Drive sync.
  Documented surface is create/get only —
  no `files.list` q grammar, copy, reparent,
  multipart upload or `alt=media` documented —
  no Sheets v4 at all, no disk-backed state contract,
  self-described as mostly vibe-coded, issues closed.
  Adopting it would still mean building the Sheets half,
  the disk store, and most of the Drive surface.
- `christophd/simulator-google-sheets` —
  Java/Spring, scenario-based canned responses
  (the model being abandoned), no Drive, dormant.
- WireMock, Mockoon, MockServer, openapi-mock, HAR replay —
  stubbing and record/replay frameworks;
  stateless or frozen by design.
- Official Google emulators and the `fake-gcs-server` family
  cover Cloud Platform APIs only (Pub/Sub, Spanner, GCS);
  no Workspace API (Drive/Sheets) emulator exists,
  official or community.

Nothing combines Drive v3 and Sheets v4
with real state behind them,
let alone state a test can seed and assert as files.

## Decision

The emulator holds real state on disk
and answers the API from it.
Requests mutate files; reads reflect files;
tests seed by writing files and assert by reading them.

Only the surface consumers actually use is modelled,
and everything outside it fails loudly
(see `specs/features/errors-and-auth/spec.md`) —
fidelity is a maintained contract, not an aspiration.

## Consequences

- Consumer test suites drop per-endpoint stubbing entirely;
  scenario setup becomes data, not code.
- Multi-step flows hold together because state exists
  (duplicate-name renames, copy-then-read, reparenting).
- The modelled surface must grow in the same change
  that a consumer adopts a new endpoint or clause —
  the fail-loud boundary turns omissions into red tests.
- Fidelity gaps against real Google remain possible;
  each known relaxation is recorded in the feature specs.
