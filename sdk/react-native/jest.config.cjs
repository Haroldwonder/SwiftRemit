/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  // Source files use ESM-style './foo.js' specifiers that point at './foo.ts';
  // map them back so ts-jest (running under CommonJS) can resolve them.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // The `@swiftremit/sdk` workspace dependency isn't linked outside a
        // full monorepo install; skip type-checking during test transpilation
        // so tests can run against mocked modules without that link in place.
        isolatedModules: true,
      },
    ],
  },
};
