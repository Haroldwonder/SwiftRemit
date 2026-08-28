# swiftremit Helm chart — experimental / future work (SR-217)

This chart is **not deployed by any pipeline**. `helm-ci.yml` lints, templates
and `kubeconform`-validates it against `values.dev.yaml`, `values.staging.yaml`
and `values.production.yaml` on every change, but nothing runs `helm upgrade`,
`helm install` or `kubectl apply` against a real cluster.

The authoritative deployment mechanism today is **Docker Compose on a VM over
SSH** (`docker-compose.yml`, driven by `.github/workflows/deploy-staging.yml`).
See `docs/DEPLOYMENT.md` → *Deployment mechanisms* for the full picture.

## What this chart is for

Keeping a validated, security-hardened Kubernetes manifest set ready so that
adopting Kubernetes later is a matter of adding a deploy job, not writing the
chart from scratch. It carries:

- non-root containers, read-only root filesystems, dropped capabilities (SR-103)
- resource requests/limits and liveness/readiness probes on every workload
- HPAs and PodDisruptionBudgets
- an optional Alertmanager deployment (`alertmanager.enabled`, SR-214) whose
  routing config is kept identical to `monitoring/alertmanager.yml`

## If Kubernetes becomes the target

Add a `helm upgrade --install` job to a deploy workflow, gated the same way the
SSH deploys are (environment protection rules, required reviewers), and update
the table in `docs/DEPLOYMENT.md`.
