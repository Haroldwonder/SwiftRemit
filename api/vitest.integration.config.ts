import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
});
