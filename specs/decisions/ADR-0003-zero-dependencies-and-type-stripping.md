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
so `node src/main.ts` runs directly —
the Docker image copies sources and runs them, no install, no build.

Package consumers get compiled output:
`pnpm run build` runs `tsc -p tsconfig.build.json`
(with `rewriteRelativeImportExtensions`)
emitting `dist/` with declarations,
because Node refuses to strip types inside `node_modules`
and consumer toolchains do not transpile dependencies.
`dist/` is committed and CI fails if it drifts from sources
(`git diff --exit-code dist` after an explicit build step),
so a fixed commit's `dist/` is always valid for that commit.

Build is **not** wired to the `prepare` lifecycle hook.
A `prepare` script on a dependency forces pnpm to build it in
isolation for every consumer that pulls it as a git dependency —
which means installing this repo's own devDependencies from
scratch inside that isolated fetch, on every install, for every
consumer, forever. Under network flakiness that nested install can
itself stall and retry, and early v0.2.0 shipped exactly that:
installing this package as a git devDependency could spawn a
runaway chain of nested `pnpm install` processes. Since `dist/`
is already committed and verified, no consumer ever needs a build
step at all — `prepare` bought nothing and cost availability.

## Consequences

- Installing from git is a pure file copy — no lifecycle script
  runs, nothing to build, nothing to fail.
- No supply-chain surface: nothing to audit, nothing to renovate.
- The erasable-syntax constraint binds all future code;
  CI's typecheck and tests run before any consumer sees a commit.
- Two import dialects coexist
  (`.ts` in sources, rewritten to `.js` in `dist/`) —
  the build config owns that translation.
- Contributors must remember to run `pnpm run build` (CI enforces
  it via the dist-freshness check, so a forgotten build fails the
  PR loudly rather than shipping stale output).
