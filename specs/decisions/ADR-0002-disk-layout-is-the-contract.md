# ADR-0002: The disk layout is a public contract

- Status: Draft
- Date: 2026-07-19

## Context

A stateful emulator could keep its state anywhere —
memory, SQLite, an opaque blob store.
But the driving use case (illo3d's e2e suite)
wants the local-csv testing model on the Google backend too:
seed files in, act through the app, assert files out,
with fixtures a human can read and diff.

## Decision

State is a mirrored tree of plain files:
one directory per Drive folder,
one directory per spreadsheet with one RFC 4180 CSV per tab,
plain files for everything else,
and a single pretty-printed `_index.json`
holding Drive metadata (ids, parents, MIME types)
and the id counter.

The layout is specified in `specs/features/disk-state/spec.md`
and treated as public API:
changing it is a breaking change for consumers' fixtures
and follows semver accordingly.
Ids are deterministic so final-state assertions stay stable.
Sibling name collisions — legal in Drive, impossible on disk —
are decorated `<name>~<id>` and renormalised
once the plain name frees up,
so settled trees stay human-readable.

## Consequences

- Seeding and asserting need no emulator API at all:
  a test can write a CSV and read one back with the filesystem.
- Fixtures are diffable in review
  and interchangeable with local-CSV-backend fixtures
  when consumers keep their CSV dialects aligned.
- The tree constrains names
  (no path separators or control characters);
  the emulator rejects rather than approximates.
- Restart resumes the world from disk,
  which is what makes the dev-mode server useful.
