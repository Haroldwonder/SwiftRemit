module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {},
  overrides: [
    {
      // SR-032: raw SQL must live behind a repository (backend/src/repositories/).
      // Legacy call sites below still query the pool directly and are grandfathered
      // in until they're migrated; new code outside repositories/ must not add more.
      files: ['src/**/*.ts'],
      excludedFiles: [
        'src/repositories/**',
        'src/__tests__/**',
        'src/migrate.ts',
        'src/metrics.ts',
        'src/webhook-health.ts',
        'src/admin-confirmation.ts',
        'src/webhook-handler.ts',
        'src/transaction-state.ts',
        'src/database.ts',
        'src/kyc-expiry-notifier.ts',
        'src/kyc-poller.ts',
        'src/notification-service.ts',
        'src/webhook-logger.ts',
        'src/api.ts',
        'src/kyc-upsert-service.ts',
        'src/distributed-lock.ts',
        'src/sep24-service.ts',
        'src/webhooks/store.ts',
        'src/routes/compliance.ts',
      ],
      rules: {
        // Targets calls of the shape pool.query(...) / this.pool.query(...) /
        // client.query(...) / getPool().query(...) — i.e. calls against a
        // pg Pool/PoolClient — without flagging arbitrary `.query(...)` calls
        // on repository or service objects (e.g. `this.repo.query(filter)`).
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "CallExpression[callee.property.name='query'][callee.object.name=/^(pool|client)$/]",
            message:
              'Raw SQL queries must live in backend/src/repositories/ — add or extend a repository method instead.',
          },
          {
            selector:
              "CallExpression[callee.property.name='query'][callee.object.property.name='pool']",
            message:
              'Raw SQL queries must live in backend/src/repositories/ — add or extend a repository method instead.',
          },
          {
            selector:
              "CallExpression[callee.property.name='query'][callee.object.callee.name='getPool']",
            message:
              'Raw SQL queries must live in backend/src/repositories/ — add or extend a repository method instead.',
          },
        ],
      },
    },
  ],
};
