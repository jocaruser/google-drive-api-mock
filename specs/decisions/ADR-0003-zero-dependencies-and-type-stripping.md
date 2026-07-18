# ADR-0003: Zero runtime dependencies, TypeScript run natively

- Status: Draft
- Date: 2026-07-19

## Context

The emulator is consumed three ways:
imported in-process by test suites,
run as a dev server (`pnpm run google-mock` in consumers),
and shipped as a Docker image.
Every dependency and build step multiplies across those paths,
and Node ≥ 22.18 strips erasable TypeScript syntax natively.

## Decision

Runtime dependencies: none.
HTTP is `node:http`, the CSV codec is ~50 lines,
web-standard `Request`/`Response` carry the handler.

Sources are erasable-only TypeScript
(no enums, namespaces, or parameter properties)
with explicit `.ts` import extensions,
so `node src/server.ts` runs directly —
the Docker image copies sources and runs them, no install, no build.

Package consumers get compiled output:
`prepare` runs `tsc -p tsconfig.build.json`
(with `rewriteRelativeImportExtensions`)
emitting `dist/` with declarations,
because Node refuses to strip types inside `node_modules`
and consumer toolchains do not transpile dependencies.

## Consequences

- Installing from git builds automatically (`prepare`);
  no registry or publish pipeline is required to consume the repo.
- No supply-chain surface: nothing to audit, nothing to renovate.
- The erasable-syntax constraint binds all future code;
  CI's typecheck and tests run before any consumer sees a commit.
- Two import dialects coexist
  (`.ts` in sources, rewritten to `.js` in `dist/`) —
  the build config owns that translation.
