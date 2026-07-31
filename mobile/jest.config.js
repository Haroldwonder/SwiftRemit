const Module = require('module');

// ── Monorepo hoisting shim ────────────────────────────────────────────────────
// The repo root hoists react-native 0.86 (pulled up as a peer dependency of the
// sdk/react-native workspace), while this workspace is pinned to 0.79.1 for Expo
// SDK 53 and therefore keeps its own nested copy in mobile/node_modules.
//
// `jest-expo` is installed in the ROOT node_modules, so its top-level
// `require('react-native/jest-preset')` resolves to 0.86 — a version that no
// longer ships that file and throws "The React Native Jest preset has moved to a
// separate package" while jest is still loading its config.
//
// Resolve that single specifier against this workspace so jest-expo derives its
// preset from the react-native version the app actually runs on.
const localReactNativeJestPreset = require.resolve('react-native/jest-preset');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'react-native/jest-preset') {
    return localReactNativeJestPreset;
  }
  return originalResolveFilename.call(this, request, ...rest);
};
let jestExpoPreset;
try {
  jestExpoPreset = require('jest-expo/jest-preset');
} finally {
  Module._resolveFilename = originalResolveFilename;
}

// jest-expo mirrors every tsconfig `paths` entry into moduleNameMapper. Our
// tsconfig pins `react`/`react/*` at ./node_modules/@types/react purely so the
// TypeScript compiler picks the workspace-local JSX types over the hoisted root
// copy — those targets are declaration files and can never be `require`d, so
// drop the type-only entries before handing the mapper to jest.
const runtimePresetModuleNameMapper = Object.fromEntries(
  Object.entries(jestExpoPreset.moduleNameMapper || {}).filter(
    ([, target]) => !String(target).includes('/@types/')
  )
);

/** @type {import('jest').Config} */
module.exports = {
  ...jestExpoPreset,
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
  // src/pact holds the Pact consumer contract suite (SR-062). Like the frontend
  // and sdk workspaces it is written against vitest and is run by
  // `npm run test:pact`, not by the jest unit-test run.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/pact/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      functions: 70,
      branches: 60,
      statements: 70,
    },
  },
  coverageReporters: ['text', 'lcov', 'json-summary'],
  moduleNameMapper: {
    ...runtimePresetModuleNameMapper,
    // Same hoisting problem as above, but inside the jest sandbox: pin every
    // react-native import to this workspace's 0.79.1 copy.
    // react 19.2 is hoisted to the repo root while this workspace is pinned to
    // 19.0.0; react-test-renderer would otherwise load the root copy and every
    // render would blow up with "Invalid hook call / more than one copy of
    // React". Pin react and react-native to the workspace copies.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^react-native$': '<rootDir>/node_modules/react-native',
    '^react-native/(.*)$': '<rootDir>/node_modules/react-native/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|socket\\.io-client))',
  ],
};
