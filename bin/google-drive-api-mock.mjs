#!/usr/bin/env node
// Thin bin shim: the real bootstrap (env parsing, listen) is src/main.ts,
// compiled to dist/main.js — one bootstrap for bin, Docker and pnpm start.
import '../dist/main.js'
