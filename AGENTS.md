# Agent Guidelines for google-drive-api-mock

This repository is spec-driven. Before any work:

1. Read `specs/README.md`, then the `specs/features/` capability
   your change touches, then the relevant `specs/decisions/` ADRs.
2. Specs lead, code follows: a change to observable behaviour lands
   with the matching `specs/features/` update in the same PR.
3. ADRs follow the lifecycle in `specs/decisions/README.md` —
   new ADRs start as `Status: Draft` and are published only when the
   user explicitly confirms.

## Golden rules

- **Zero runtime dependencies** (ADR-0003). Adding one requires a
  superseding ADR, not a lockfile diff.
- **Erasable TypeScript only**: no enums, namespaces, or parameter
  properties; relative imports carry explicit `.ts` extensions.
  `node src/server.ts` must always run without a build.
- **Fail loudly outside the modelled surface** (ADR-0001): never
  widen behaviour silently; extend the surface and its spec together.
- **The disk layout is public API** (ADR-0002): changing it is a
  breaking change and follows semver.
- **Never import consumer code.** This repository must not know
  illo3d's schema, headers, or metadata shapes; app-aware seeding
  belongs in the consumer's test helpers.
- Prose under `specs/` uses semantic line breaks and British English
  (ADR-0004).
- Commits follow Conventional Commits; commit only when the user asks.

## Commands

- `pnpm install` — installs dev tooling only. `dist/` is committed,
  not rebuilt on install (no `prepare` hook — see ADR-0003: a
  `prepare` script on a git-installed package forces an isolated
  nested build for every consumer and caused a real incident).
- After changing `src/`, run `pnpm run build` before committing;
  CI fails if committed `dist/` drifts from sources.
- `pnpm typecheck` / `pnpm test` / `pnpm build` — the CI gate.
- `pnpm start` — run the server from sources (no build).
