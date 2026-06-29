import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.chaos.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
    // Run chaos tests sequentially — they mutate shared Toxiproxy state
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
      },
    },
  },
});
