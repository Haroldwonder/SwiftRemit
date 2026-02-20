# Security and Threat Model

This document is intended to help auditors, contributors, and deployers
understand the security assumptions, threat model, and safe usage notes for
SwiftRemit.  The contract is designed for an escrow-based USDC remittance
platform on the Soroban/Stellar network.  Although extensive testing and
defensive coding has been applied, this is not a formal audit and users
should exercise caution when deploying to production.

---

## Threat Model

The following attacker capabilities are considered when reasoning about the
contract:

1. **External User (Sender/Agent)**
   * May attempt unauthorized state changes by calling contract functions
     without required signatures.
   * May supply invalid data (zero amounts, unregistered agents, etc.).
   * May reuse or replay transaction identifiers.

2. **Malicious or Compromised Agent**
   * An agent who is registered in the system attempts to confirm a payout
     twice or manipulate remittance status.
   * An agent tries to withdraw funds that do not belong to them.

3. **Compromised Admin Key**
   * The administrator's private key is leaked or misused.
   * An attacker with admin privileges attempts to register/remove agents,
     change fees, withdraw funds, pause/unpause the contract, etc.

4. **Token Contract Misbehaviour**
   * The USDC token contract does not follow the expected transfer
     semantics or reverts unexpectedly.
   * An attacker deploys a malicious token contract and passes its address
     during initialization.

5. **Blockchain and Runtime Risks**
   * Expiry timestamp manipulation or use of stale ledger time.
   * Storage corruption, unexpected `no_std` behaviour.
   * Denial‑of‑service by spamming the contract (e.g. exhausting gas).

6. **Other**
   * Race conditions due to concurrent invocations (Soroban enforces serial
     execution but duplicate settlement hashes add extra protection).
   * Unexpected address formats or zero addresses (additional validation
     is minimal since the SDK already checks addresses).

The contract applies the following defenses against these threats:

* _Authorization checks_ using `require_auth` on addresses for every
  state-changing function.
* _Status validation_ ensures remittances move only from `Pending` to
  `Completed`/`Cancelled` and prevents double confirmations and cancellations.
* _Overflow protection_ using checked arithmetic and explicit `Overflow`
  errors.
* _Agent registration guard_ to prevent unapproved agents from receiving
  funds.
* _Duplicate settlement detection_ via `SettlementHash` storage key.
* _Expiry checks_ that reject confirmations after a configured deadline.
* _Pause/Unpause_ functionality for emergency halts by admin.
* Comprehensive unit tests covering success and failure paths.

---

## Assumptions

The correct operation of SwiftRemit depends on several external and
protocol-level assumptions:

* **Trusted USDC Token Contract** – The `usdc_token` address supplied during
  initialization must implement the standard Soroban token interface and
  behave as expected (transfers succeed, balances update correctly). A
  malicious token could lock funds or mint arbitrarily.
* **Single Admin Model** – There is one administrator address with full
  privileges. The contract does *not* support multisig or role separation.
* **Off‑Chain Payout Process** – Actual fiat transfers happen off-chain
  between senders, agents, and recipients. The contract only handles USDC
  escrowand cannot verify that fiat was delivered. Agents are expected to
  act honestly or be removed/blacklisted by the admin.
* **Clock and Ledger Time** – Expiry enforcement relies on the ledger
  timestamp; validators control this. Misbehaving consensus could affect
  expiries.
* **No Reentrancy** – Soroban contracts are executed atomically and do not
  allow reentrancy in the same invocation. The code nonetheless performs
  state updates before external transfers where feasible.
* **Sender Authorization** – Senders must approve the contract to transfer
  USDC on their behalf before creating a remittance.
* **Resource Limits** – Storage and compute costs are expected to be
  reasonable; the contract does not guard against unbounded growth of
  persistent storage (many remittances). It is assumed that the platform
  and agents will manage storage costs.
* **Network Safety** – The platform is deployed on a network where standard
  Stellar/Soroban security holds (e.g. validators are not malicious at
  scale).

---

## Known Limitations and Risks

The following limitations should be understood by auditors and future
contributors:

* **Not Audit‑Grade** – The code has not undergone a third‑party security
  audit.  Edge cases may be untested.
* **Single Token Only** – The contract is hard‑coded to a single USDC token
  instance. A different asset type requires redeployment.
* **Agent Removal** – Removing an agent does not impact existing pending
  remittances; those can still be confirmed by the (now removed) address
  unless the admin manually intervenes or the remittance expires and is
  eventually cancelled by the sender.
* **No Fraud Detection** – There is no on‑chain mechanism to dispute
  payouts. The system relies on good governance and off‑chain dispute
  resolution.
* **Expiry Is Optional** – `create_remittance` accepts an optional expiry
  timestamp. If `None` is provided, remittances can stay pending
  indefinitely, potentially locking funds if the agent never confirms or
  the sender never cancels.
* **No Rate Limiting** – The contract does not throttle function calls.
  A malicious actor could spam remittance creations or other calls until
  gas or storage limits are reached.
* **Admin Key Centralization** – Loss or compromise of the admin key allows
  an attacker to manipulate fees, withdraw funds, pause/unpause contract,
  and register malicious agents.
* **No Slippage Checks** – Token transfers assume exact amounts; there are
  no safeguards against tokens charging fees on transfer or imposing
  exchange rate slippage.
* **Error Information** – Contract errors are returned as numeric codes but
  might not include rich context. Clients should handle all failure cases
  explicitly.
* **No Upgrade Mechanism** – The contract is immutable once deployed.
  Bug fixes require redeployment and migration of state off‑chain.
* **Testing Scope** – Tests focus on happy paths and common failure modes.
  They do not simulate scenarios such as corrupted storage, malicious token
  behavior, or gas exhaustion.

---

## Safe Usage Notes

To minimize risk when deploying and interacting with SwiftRemit:

1. **Vet the USDC Token** – Only initialize the contract with a well‑audited
   token contract. Never use untrusted or user‑supplied token addresses.
2. **Secure Admin Keys** – Store the administrator private key in a
   hardware wallet or equivalent. Consider using a multisig abstraction
   outside the contract for key management.
3. **Agent Due Diligence** – Only register agents who have been properly
   vetted. Maintain an off‑chain registry and remove compromised agents
   promptly.
4. **Use Expiries** – Encourage senders to set reasonable expiration
   timestamps to avoid funds being locked indefinitely.
5. **Monitor Fees and Balances** – Regularly withdraw accumulated fees and
   audit contract balances to detect anomalies.
6. **Pause Capability** – Be prepared to use `pause`/`unpause` in case of
   detected issues. Remember that pausing only blocks new `confirm_payout`
   calls; existing pending remittances can still be cancelled by senders.
7. **Off‑Chain Controls** – Implement business logic and compliance checks
   (KYC/AML, fraud detection) off‑chain. The contract provides no such
   functionality.
8. **Upgrade Path Planning** – Since the contract is immutable, maintain a
   strategy for migrating users and funds if upgrades are required.
9. **Testing Before Deployment** – Run the full test suite and consider
   adding property‑based tests. Use Soroban's simulation tools to perform
   fuzzing and gas profiling.
10. **Audit Fees Range** – Ensure fee updates are within expected bounds
    (0–10000 bps). Consider granting read‑only access to fee history for
    transparency.

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please notify the maintainers
via [the repository's issue tracker](https://github.com/Haroldwonder/SwiftRemit)
or by following the instructions in `CONTRIBUTING.md`.  Do **not** publish
exploit details publicly before the issue is fixed.

---

This document is part of the codebase and should be updated whenever new
security-relevant code is added or the threat model changes.