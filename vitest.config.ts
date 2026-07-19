import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts is process bootstrap only (env defaults + listen), like
      // illo3d's src/main.tsx: exercised by Docker/bin smoke paths, not
      // units. index.ts is a pure re-export barrel with no attributable
      // statements (a test still pins its export surface).
      exclude: ['src/main.ts', 'src/index.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
