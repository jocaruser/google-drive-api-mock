# ADR-0004: Writing and workflow conventions inherited from illo3d

- Status: Draft
- Date: 2026-07-19

## Context

This repository was extracted from illo3d
and is maintained by the same people.
illo3d's conventions are recorded in its own ADRs:
semantic line breaks (illo3d ADR-0009),
British English (illo3d ADR-0010),
spec-driven workflow with `specs/features/` as canonical behaviour
and `specs/decisions/` for intent.

## Decision

This repository adopts the same standards:

- Prose under `specs/` uses semantic line breaks
  with an 80-character line cap, judged by meaning —
  never rewrapped by scripts.
- British English throughout prose and identifiers' documentation.
- `specs/features/` is canonical:
  any change to observable behaviour updates the matching spec
  in the same pull request.
- ADRs follow the lifecycle in `specs/decisions/README.md`
  (Draft until explicitly published, then immutable;
  supersede or amend instead of rewriting).
- Commits follow Conventional Commits;
  version bumps follow semver,
  with the disk layout (ADR-0002) counted as public API.

## Consequences

- Contributors move between illo3d and this repository
  without switching rules.
- Diffs over specs stay reviewable line by line.
- The conventions hold even if the repositories diverge otherwise;
  changing one here requires a superseding ADR here.
