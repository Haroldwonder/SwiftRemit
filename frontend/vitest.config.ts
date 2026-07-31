import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // `e2e/` holds Playwright specs (run via `npm run e2e`); they must not be
    // collected by Vitest — Playwright's test.describe() throws under Vitest.
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    setupFiles: './src/setupTests.ts',
    snapshotOptions: {
      snapshotFormat: {
        printBasicPrototype: false,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.stories.{ts,tsx}',
        'src/setupTests.ts',
        'src/main.tsx',
      ],
    },
  },
});
