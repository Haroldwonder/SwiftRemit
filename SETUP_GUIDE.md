# Setup Guide

## Security Checklist

Before going to production, verify each item below:

- [ ] **Change the default admin secret key.** The sample value shown in this guide (`change-me-admin-secret`) is a placeholder only. Never deploy to production with the default/sample admin secret key. Generate a strong, unique secret and set it via the `ADMIN_SECRET_KEY` environment variable.
- [ ] Enable the firewall and restrict inbound traffic to required ports only.
- [ ] Use HTTPS/TLS for all public endpoints.
- [ ] Rotate credentials and API keys regularly.

## Firewall Rules

Restrict inbound access so that only the public web entrypoint is reachable from the internet. The backend API and database ports must **not** be publicly accessible; allow them only from trusted hosts (the reverse proxy / application servers).

| Port | Service | Inbound access |
| --- | --- | --- |
| 80 | HTTP (redirect to HTTPS) | Public |
| 443 | HTTPS | Public |
| 8000 | Backend API | Private only (reverse proxy / app servers) |
| 5432 | PostgreSQL | Private only (app servers) |

Example using `ufw` (adjust the trusted source ranges to your network):

```sh
# Default deny inbound, allow outbound
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Public web entrypoints
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Backend API: only from the reverse proxy / app servers
sudo ufw allow from 10.0.0.0/24 to any port 8000 proto tcp

# PostgreSQL: only from the app servers
sudo ufw allow from 10.0.0.0/24 to any port 5432 proto tcp

sudo ufw enable
sudo ufw status verbose
```

Equivalent `iptables` rules:

```sh
# Allow established connections
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Public web entrypoints
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Backend API: only from the reverse proxy / app servers
iptables -A INPUT -p tcp --dport 8000 -s 10.0.0.0/24 -j ACCEPT

# PostgreSQL: only from the app servers
iptables -A INPUT -p tcp --dport 5432 -s 10.0.0.0/24 -j ACCEPT

# Drop everything else
iptables -A INPUT -j DROP
```

If your provider offers a cloud firewall / security group, apply the same policy there: expose only 80/443 publicly and keep 8000 and 5432 restricted to trusted sources.

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
