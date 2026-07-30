#!/usr/bin/env python3
"""SR-103 — assert the rendered Helm manifests meet the chart's security bar.

Reads a multi-document YAML stream (the output of `helm template`) on stdin and
checks, for every value set:

  * no ConfigMap carries a key that the chart declares as a Secret, and no
    ConfigMap value looks like a credential
  * every container runs as non-root with privilege escalation disabled, a
    read-only root filesystem, and ALL capabilities dropped
  * every container declares both resource requests and limits
  * every container has a liveness and a readiness probe

Usage:
    helm template ... | python3 scripts/check-rendered-manifests.py --label dev
"""

from __future__ import annotations

import argparse
import re
import sys

import yaml

# Keys that must only ever appear in a Secret. Kept in sync with the `secret:`
# blocks in charts/swiftremit/values*.yaml.
SECRET_KEYS = {
    "DATABASE_URL",
    "CONTRACT_RPC_URL",
    "ANCHORS_ADMIN_API_KEY",
    "JWT_SECRET",
    "CONTRACT_ID",
    "ADMIN_SECRET_KEY",
}

# Values that look like credentials regardless of the key they sit under.
CREDENTIAL_VALUE = re.compile(
    r"(postgres(ql)?://[^:]+:[^@]+@)"  # DSN with an inline password
    r"|(^S[A-Z2-7]{55}$)"  # Stellar secret key
    r"|(secret|password|passwd|api[_-]?key)\s*[:=]",
    re.IGNORECASE,
)


def containers_of(doc: dict):
    """Yield (kind, name, container) for every container in a workload."""
    kind = doc.get("kind")
    if kind not in ("Deployment", "StatefulSet", "DaemonSet", "Job"):
        return
    name = doc.get("metadata", {}).get("name", "<unnamed>")
    spec = doc.get("spec", {}).get("template", {}).get("spec", {})
    for container in spec.get("containers", []) or []:
        yield kind, name, container, spec


def check(docs, label: str) -> list[str]:
    problems: list[str] = []

    for doc in docs:
        if not isinstance(doc, dict) or not doc.get("kind"):
            continue

        kind = doc["kind"]
        name = doc.get("metadata", {}).get("name", "<unnamed>")

        # ── Secrets must never leak into a ConfigMap ────────────────────────
        if kind == "ConfigMap":
            for key, value in (doc.get("data") or {}).items():
                if key in SECRET_KEYS:
                    problems.append(
                        f"ConfigMap/{name} exposes secret key {key!r} — it belongs in the Secret"
                    )
                elif isinstance(value, str) and value and CREDENTIAL_VALUE.search(value):
                    problems.append(
                        f"ConfigMap/{name} key {key!r} holds a credential-shaped value"
                    )

        # ── Workload hardening ─────────────────────────────────────────────
        for _kind, workload, container, pod_spec in containers_of(doc):
            cname = container.get("name", "<unnamed>")
            where = f"{_kind}/{workload}: container {cname}"

            pod_sc = pod_spec.get("securityContext") or {}
            sc = container.get("securityContext") or {}

            run_as_non_root = sc.get("runAsNonRoot", pod_sc.get("runAsNonRoot"))
            if run_as_non_root is not True:
                problems.append(f"{where} does not set runAsNonRoot: true")

            if sc.get("allowPrivilegeEscalation") is not False:
                problems.append(f"{where} does not set allowPrivilegeEscalation: false")

            if sc.get("readOnlyRootFilesystem") is not True:
                problems.append(f"{where} does not set readOnlyRootFilesystem: true")

            dropped = ((sc.get("capabilities") or {}).get("drop")) or []
            if "ALL" not in [str(c).upper() for c in dropped]:
                problems.append(f"{where} does not drop ALL capabilities")

            resources = container.get("resources") or {}
            for section in ("requests", "limits"):
                block = resources.get(section) or {}
                for resource in ("cpu", "memory"):
                    if resource not in block:
                        problems.append(f"{where} is missing resources.{section}.{resource}")

            for probe in ("livenessProbe", "readinessProbe"):
                if not container.get(probe):
                    problems.append(f"{where} has no {probe}")

    if problems:
        print(f"✗ [{label}] rendered manifests failed {len(problems)} check(s):\n", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="chart", help="value set name, for messages")
    args = parser.parse_args()

    docs = list(yaml.safe_load_all(sys.stdin.read()))
    problems = check(docs, args.label)
    if problems:
        return 1

    rendered = sum(1 for d in docs if isinstance(d, dict) and d.get("kind"))
    print(f"✓ [{args.label}] {rendered} manifests pass secret, security-context, "
          f"resource and probe checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
