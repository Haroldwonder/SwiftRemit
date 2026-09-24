# Setup Guide

This guide walks through setting up the project for local development and production deployment.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

## Local Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/your-org/your-repo.git
   cd your-repo
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the example environment file and fill in your local values:

   ```bash
   cp .env.example .env
   ```

4. Start the local database and run migrations:

   ```bash
   npm run db:migrate
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

## Environment Variables

| Variable | Description | Required |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `DB_SSL` | Enable SSL/TLS for database connections (`true`/`false`) | No (defaults to `false` locally) |
| `DB_SSL_REJECT_UNAUTHORIZED` | Reject self-signed/untrusted certificates (`true`/`false`) | No (defaults to `true`) |
| `NODE_ENV` | Runtime environment (`development`/`production`) | Yes |

## Database SSL/TLS Configuration

Database connections **must** use SSL/TLS in production. Local development continues to work without SSL so contributors do not need to provision certificates.

### Production

Set the following environment variables in your production environment:

```bash
NODE_ENV=production
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
```

When `NODE_ENV=production`, SSL is enabled automatically even if `DB_SSL` is not explicitly set. `DB_SSL_REJECT_UNAUTHORIZED=true` ensures the server certificate is validated against a trusted CA; do not disable this in production unless you fully understand the risk.

If your managed database provider requires a specific CA bundle, point the connection at it via `DATABASE_SSL_CA` (path to the PEM file) and keep `DB_SSL_REJECT_UNAUTHORIZED=true`.

### Local Development

No changes are required. SSL is disabled by default when `NODE_ENV` is not `production`, so local connections to `localhost` continue to work without certificates.

To test SSL locally, set `DB_SSL=true` and, if using a self-signed certificate, `DB_SSL_REJECT_UNAUTHORIZED=false`.

## Security Checklist

- [x] Database connections require SSL/TLS in production (see [Database SSL/TLS Configuration](#database-ssltls-configuration))
- [ ] Secrets are stored in a managed secret store, not in the repository
- [ ] Authentication endpoints are rate limited
- [ ] Dependencies are scanned for known vulnerabilities in CI

## Deployment

1. Build the application:

   ```bash
   npm run build
   ```

2. Run migrations against the production database (with SSL enabled as described above):

   ```bash
   NODE_ENV=production npm run db:migrate
   ```

3. Start the production server:

   ```bash
   NODE_ENV=production npm start
   ```
