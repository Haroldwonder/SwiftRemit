# Reproducible Builds — SR-107

SwiftRemit contracts are built reproducibly: any third party can independently
rebuild the exact WASM deployed to mainnet and verify that the SHA-256 matches.
This is the basis for trustless auditing of a deployed contract.

---

## Quick verification (external auditor)

```bash
# 1. Clone the repository at the release tag you want to verify
git clone https://github.com/Haroldwonder/SwiftRemit.git
cd SwiftRemit
git checkout v1.0.0   # replace with the release tag

# 2. Prerequisites: Docker (any recent version), git
docker --version

# 3. Build the WASM reproducibly
bash scripts/reproducible-build.sh
# Prints: BUILD SHA256: <hash>

# 4. Compare against the published hash for this release
cat releases/v1.0.0.sha256
# OR: curl https://github.com/Haroldwonder/SwiftRemit/releases/download/v1.0.0/swiftremit-v1.0.0.sha256

# 5. The two hashes should be identical ✓
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | ≥ 20.10 | Hermetic build environment |
| git | any | Checkout and tag resolution |
| sha256sum / shasum | any | Hash comparison |

No Rust toolchain is required on the host — Docker installs the pinned version
inside the container.

---

## How it works

The build uses `docker/Dockerfile.reproducible`, which:

1. Starts from `rust:stable-slim` (the channel pinned in `rust-toolchain.toml`).
2. Installs `wasm-opt` (binaryen) and `stellar` CLI at pinned versions.
3. Adds the `wasm32-unknown-unknown` target.
4. Sets `SOURCE_DATE_EPOCH=0` and `CARGO_INCREMENTAL=0` to suppress non-determinism.
5. Builds with `cargo build --release --target wasm32-unknown-unknown`.
6. Optimises with `stellar contract optimize`.
7. The final image contains only `/out/swiftremit.wasm` and `/out/swiftremit.wasm.sha256`.

`Cargo.toml` already enforces `codegen-units = 1`, `lto = true`, and `strip = "symbols"`,
all of which are required for a reproducible build.

---

## Step-by-step reproduction

```bash
# Clone and checkout the exact tag
git clone https://github.com/Haroldwonder/SwiftRemit.git
cd SwiftRemit
git checkout v1.0.0

# Single build (fast path)
bash scripts/reproducible-build.sh
# Output: build/reproducible/swiftremit.wasm
#         build/reproducible/swiftremit.wasm.sha256
#         prints: BUILD SHA256: <hash>

# Double-build verification (confirms reproducibility across two independent builds)
bash scripts/verify-reproducible-build.sh
# On success prints: REPRODUCIBILITY VERIFIED: <hash>

# Verify against the published release hash
bash scripts/verify-reproducible-build.sh --expected "$(curl -sSf \
  https://github.com/Haroldwonder/SwiftRemit/releases/download/v1.0.0/swiftremit-v1.0.0.sha256)"
```

---

## Finding and verifying the published hash

### From GitHub Releases

Every release publishes two files:
- `swiftremit.wasm` — the optimised WASM
- `swiftremit-<tag>.sha256` — the SHA-256 of that WASM

```bash
# Download both
curl -sSfLO https://github.com/Haroldwonder/SwiftRemit/releases/download/v1.0.0/swiftremit.wasm
curl -sSfL  https://github.com/Haroldwonder/SwiftRemit/releases/download/v1.0.0/swiftremit-v1.0.0.sha256

# Verify
sha256sum -c <<< "$(cat swiftremit-v1.0.0.sha256)  swiftremit.wasm"
```

### From the repository

```bash
# Latest release hash
cat releases/latest-hash.txt

# Specific release hash
cat releases/v1.0.0.sha256
```

---

## Verifying the hash matches the mainnet deployment

```bash
# Install stellar CLI (https://github.com/stellar/stellar-cli)
stellar contract info \
  --id <MAINNET_CONTRACT_ID> \
  --rpc-url https://soroban-rpc.mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"
# Look for the wasm_hash field in the output

# Compare against the published hash
echo "Published: $(cat releases/v1.0.0.sha256)"
echo "On-chain:  <wasm_hash from stellar contract info>"
# They should match ✓
```

---

## Worked example (expected output)

```
$ bash scripts/reproducible-build.sh --tag swiftremit-repro-demo

[reproducible-build] Reproducible build
[reproducible-build]   Repo root:    /home/user/SwiftRemit
[reproducible-build]   Git SHA:      a1b2c3d
[reproducible-build]   Image tag:    swiftremit-repro-demo
[reproducible-build]   Rust version: stable
[reproducible-build]   Output dir:   /home/user/SwiftRemit/build/reproducible
[reproducible-build] Building Docker image (--no-cache) …
... (Docker build output) ...
[reproducible-build] Extracting WASM artifact from image…
[reproducible-build] BUILD SHA256: 3f4a9b2c1d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a

[reproducible-build] Artifact: /home/user/SwiftRemit/build/reproducible/swiftremit.wasm (45123 bytes)
[reproducible-build] SHA-256:  /home/user/SwiftRemit/build/reproducible/swiftremit.wasm.sha256
[reproducible-build] Done.

$ bash scripts/verify-reproducible-build.sh
... (two build runs) ...
[verify-reproducible] === Comparing builds ===
[verify-reproducible] Build 1: 3f4a9b2c1d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a
[verify-reproducible] Build 2: 3f4a9b2c1d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a
[verify-reproducible] REPRODUCIBILITY VERIFIED: both builds produce the same hash
[verify-reproducible] SHA-256: 3f4a9b2c1d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a
[verify-reproducible] All checks passed.
```

---

## CI enforcement

Two CI jobs enforce reproducibility:

| Workflow | Job | When | What |
|---------|-----|------|------|
| `contract-ci.yml` | `reproducibility-check` | Every push/PR | Build once; compare against `releases/latest-hash.txt` if present |
| `reproducible-build.yml` | `reproducible-build` | Release tags | Two independent builds; publish hash as release asset |

The `deploy-mainnet.yml` gate-wasm-hash step also runs `verify-reproducible-build.sh`
before any mainnet deployment proceeds.

---

## Troubleshooting non-reproducible builds

If two builds produce different hashes:

1. **Check for embedded timestamps** — does `build.rs` call `std::time::SystemTime::now()`?
   Set `SOURCE_DATE_EPOCH=0` and confirm the build.rs respects it.
2. **Check Cargo.lock is committed** — `git status Cargo.lock` should be clean.
3. **Check for randomised HashMap iteration** — Rust's HashMap is not ordered. If
   codegen uses a HashMap and the iteration order affects output, replace with BTreeMap.
4. **Check wasm-opt version** — both builds must use the exact same `--build-arg BINARYEN_VERSION`.
5. **Check Docker layer caching** — both builds must use `--no-cache`.
