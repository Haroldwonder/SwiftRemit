import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      // Source files to measure — excludes generated/migration/script files
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/index.ts',          // entry-point bootstrapping
        'src/tracing.ts',        // OTel setup — no unit-testable logic
        'src/migrate.ts',        // migration runner
        'src/console-shim.ts',   // console patch
        'src/generate-openapi.ts',
      ],
      // Thresholds — start conservative; ratchet upward each sprint.
      // CI fails when any threshold is missed.
      thresholds: {
        lines:      60,
        functions:  60,
        branches:   55,
        statements: 60,
      },
    },
  },
});
