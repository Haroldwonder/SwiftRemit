# Setup Guide

## Security Checklist

Before going to production, verify each item below:

- [ ] **Change the default admin secret key.** The sample value shown in this guide (`change-me-admin-secret`) is a placeholder only. Never deploy to production with the default/sample admin secret key. Generate a strong, unique secret and set it via the `ADMIN_SECRET_KEY` environment variable.
- [ ] Enable the firewall and restrict inbound traffic to required ports only.
- [ ] Use HTTPS/TLS for all public endpoints.
- [ ] Rotate credentials and API keys regularly.

## Environment Variables

Create a `.env` file (or set these in your deployment environment) and replace every placeholder value with a real, secret value:

```env
# REQUIRED: replace with a strong, unique secret before production.
# Do NOT use the sample value below in production.
ADMIN_SECRET_KEY=change-me-admin-secret
```

Generate a strong secret, for example:

```sh
openssl rand -hex 32
```

Then set `ADMIN_SECRET_KEY` to the generated value. The application should refuse to start (or log a fatal error) if `ADMIN_SECRET_KEY` is unset or still equal to the sample placeholder.
