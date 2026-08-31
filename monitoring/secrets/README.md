# Alertmanager notifier secrets (SR-214)

Alertmanager (`monitoring/alertmanager.yml`) reads its notifier credentials from
files in this directory. The files themselves are **gitignored** — only this
README and `.gitkeep` are tracked.

| File | Contents | How Alertmanager uses it |
|---|---|---|
| `slack_api_url` | A Slack incoming-webhook URL (`https://hooks.slack.com/services/…`) | `slack_configs[].api_url_file` |
| `pagerduty_routing_key` | A PagerDuty Events API v2 routing key | `pagerduty_configs[].routing_key_file` |

## Local / dev

You normally don't need either file locally. If a file is absent Alertmanager
still starts; the corresponding notifier is inert and firing alerts are only
visible in the Alertmanager UI at <http://localhost:9093>.

To wire Slack locally:

```bash
printf '%s' 'https://hooks.slack.com/services/XXX/YYY/ZZZ' > monitoring/secrets/slack_api_url
docker compose up -d alertmanager
```

## Staging / production

Write the files from your secret store during provisioning, e.g.:

```bash
mkdir -p monitoring/secrets
printf '%s' "$ALERTMANAGER_SLACK_WEBHOOK"        > monitoring/secrets/slack_api_url
printf '%s' "$ALERTMANAGER_PAGERDUTY_ROUTING_KEY" > monitoring/secrets/pagerduty_routing_key
chmod 600 monitoring/secrets/*
```

For the Helm-based environments the same values come from the
`alertmanager.secrets.*` keys in `charts/swiftremit/values.*.yaml`, which land in
a Kubernetes Secret mounted at `/etc/alertmanager/secrets/`.
