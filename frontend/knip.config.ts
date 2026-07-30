import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/main.jsx', 'src/App.jsx'],
  project: ['src/**/*.{ts,tsx,js,jsx}'],
  ignore: [
    'src/**/*.stories.{ts,tsx}',
    'src/**/*.test.{ts,tsx,js,jsx}',
    'src/**/__tests__/**',
    'src/pact/**',
    'src/examples/**',
  ],
  ignoreDependencies: ['@pact-foundation/pact'],
};

export default config;
