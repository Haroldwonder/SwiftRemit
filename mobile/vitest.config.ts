import { defineConfig } from 'vitest/config';

// The mobile workspace runs its unit tests with jest (jest-expo preset, needed
// for the React Native runtime). The Pact consumer contract suite in src/pact
// is plain Node + fetch and is written against vitest, mirroring the frontend
// and sdk workspaces — `npm run test:pact` runs it here.
export default defineConfig({
  test: {
    include: ['src/pact/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
