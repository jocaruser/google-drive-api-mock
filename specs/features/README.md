# Living Specifications

`specs/features/` stores the canonical, technology-agnostic description
of observable emulator behaviour.

- One folder per capability, holding a focused `spec.md`.
- Keep `spec.md` to requirements and scenarios.
- Update these specs whenever observable behaviour changes.

Capabilities:

- [`drive-files/`](drive-files/spec.md) —
  the Drive v3 file surface: list, get, create, update, copy, delete,
  multipart upload.
- [`sheets-values/`](sheets-values/spec.md) —
  the Sheets v4 surface: spreadsheets, tabs, and cell values.
- [`disk-state/`](disk-state/spec.md) —
  the on-disk tree: seeding, asserting, ids, duplicate names.
- [`errors-and-auth/`](errors-and-auth/spec.md) —
  authentication, error shapes, and the fail-loud boundary.
