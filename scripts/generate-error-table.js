#!/usr/bin/env node
// Regenerates the "Error Codes" table in README.md from the `ContractError`
// enum in src/errors.rs, so the two never drift apart again (SR-006).
//
// Usage: node scripts/generate-error-table.js [--write]
//   (no flag)  prints the generated table to stdout
//   --write    replaces the table between the README markers in place

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ERRORS_RS = path.join(ROOT, "src", "errors.rs");
const README = path.join(ROOT, "README.md");

const START_MARKER = "<!-- ERROR_TABLE:START -->";
const END_MARKER = "<!-- ERROR_TABLE:END -->";

// Common Cause / Resolution text isn't reliably derivable from doc comments
// alone (many variants only have a one-line description), so it is
// maintained here, keyed by variant name. `node scripts/generate-error-table.js`
// fails loudly if `src/errors.rs` gains a variant that isn't listed below,
// so this table can't silently go stale.
const DETAILS = {
  AlreadyInitialized: {
    description: "Contract already initialized",
    cause: "Attempting to call initialize() on an active contract.",
    resolution: "No action required. If re-configuration is needed, check whether an admin update function exists.",
  },
  NotInitialized: {
    description: "Contract not initialized",
    cause: "Operations attempted before the contract setup is complete.",
    resolution: "The administrator must call initialize() with valid parameters before other functions.",
  },
  InvalidAmount: {
    description: "Amount must be greater than 0",
    cause: "Providing zero or negative values for a remittance.",
    resolution: "Ensure the transfer amount is a positive integer greater than 0.",
  },
  InvalidFeeBps: {
    description: "Fee must be between 0-10000 bps",
    cause: "Fee percentage set outside the 0-100% (0-10000 bps) range.",
    resolution: "Adjust the basis points to fall within the valid range (e.g., 2.5% = 250 bps).",
  },
  AgentNotRegistered: {
    description: "Agent not in approved list",
    cause: "Using an address that hasn't been added to the agent whitelist.",
    resolution: "Register the agent address first using the register_agent function.",
  },
  RemittanceNotFound: {
    description: "Remittance ID does not exist",
    cause: "Querying an ID that does not exist on the ledger.",
    resolution: "Verify the remittance ID from your transaction history or event logs.",
  },
  InvalidStatus: {
    description: "Operation not allowed in current status",
    cause: "Operation attempted while the remittance is in an incompatible state (e.g. cancelling a settled payment).",
    resolution: "Check the current status via get_remittance before retrying.",
  },
  InvalidStateTransition: {
    description: "Invalid state transition attempted",
    cause: "Requesting a status change that isn't reachable from the remittance's current state.",
    resolution: "Consult the state machine diagram and only request valid transitions.",
  },
  NoFeesToWithdraw: {
    description: "No accumulated fees available",
    cause: "Calling withdraw_fees when accumulated fees is zero.",
    resolution: "Wait until fees accrue from settled remittances before withdrawing.",
  },
  InvalidAddress: {
    description: "Invalid address format or validation failed",
    cause: "Address does not meet validation requirements.",
    resolution: "Confirm the address is a valid Stellar/Soroban address before submitting.",
  },
  SettlementExpired: {
    description: "Settlement window has expired",
    cause: "The time-lock deadline for the remittance has passed.",
    resolution: "Cancel and recreate the remittance with a new deadline.",
  },
  DuplicateSettlement: {
    description: "Settlement already executed",
    cause: "The payment was already claimed or processed.",
    resolution: "Check the transaction ledger; the funds have likely already been disbursed.",
  },
  ContractPaused: {
    description: "Contract is paused; settlements temporarily disabled",
    cause: "Circuit breaker active due to maintenance or emergency.",
    resolution: "Monitor the project's status channels and wait for an admin to unpause.",
  },
  AssetNotFound: {
    description: "Asset verification record not found",
    cause: "Querying verification data for an asset that hasn't been submitted for verification.",
    resolution: "Submit the asset for verification before querying its status.",
  },
  UserBlacklisted: {
    description: "User is blacklisted and cannot perform transactions",
    cause: "The user's address is on the blacklist.",
    resolution: "Contact an administrator to review and potentially remove the blacklist entry.",
  },
  InvalidReputationScore: {
    description: "Reputation score must be between 0 and 100",
    cause: "Supplying a reputation score outside the 0-100 range.",
    resolution: "Pass a value between 0 and 100 inclusive.",
  },
  KycNotApproved: {
    description: "User KYC is not approved",
    cause: "User has not completed KYC verification.",
    resolution: "Complete the KYC flow with an approved provider before transacting.",
  },
  SuspiciousAsset: {
    description: "Asset has been flagged as suspicious",
    cause: "The asset failed one or more verification/reputation checks.",
    resolution: "Review the asset's verification report; do not proceed without an admin override.",
  },
  AnchorTransactionFailed: {
    description: "Anchor withdrawal/deposit operation failed",
    cause: "The SEP-24 anchor rejected or failed to process the operation.",
    resolution: "Check the anchor's status and retry, or contact anchor support.",
  },
  Unauthorized: {
    description: "Caller is not authorized to perform this operation",
    cause: "Non-admin or non-owner attempting an admin/owner-only operation.",
    resolution: "Call the function using an authorized admin or owner address.",
  },
  DailySendLimitExceeded: {
    description: "User's daily send limit exceeded",
    cause: "User's total transfers in the last 24 hours exceed the configured limit.",
    resolution: "Wait for the rolling 24-hour window to reset or request a limit increase.",
  },
  TokenAlreadyWhitelisted: {
    description: "Token is already whitelisted",
    cause: "Attempting to add a token that is already whitelisted.",
    resolution: "No action required; verify with get_whitelisted_tokens.",
  },
  KycExpired: {
    description: "User KYC has expired and needs renewal",
    cause: "The user's KYC verification has passed its expiry timestamp.",
    resolution: "Re-submit KYC verification with the provider.",
  },
  TransactionNotFound: {
    description: "Transaction record not found",
    cause: "Querying a transaction ID that doesn't exist.",
    resolution: "Verify the transaction ID from event logs or the indexer.",
  },
  RateLimitExceeded: {
    description: "Rate limit exceeded",
    cause: "Caller exceeded the configured number of operations in the current window.",
    resolution: "Wait for the rate-limit window to reset before retrying.",
  },
  AdminAlreadyExists: {
    description: "Admin address already registered",
    cause: "Attempting to add an admin that is already registered.",
    resolution: "No action required; verify with get_admins.",
  },
  AdminNotFound: {
    description: "Admin address not found",
    cause: "Attempting to remove or reference an admin that isn't registered.",
    resolution: "Verify the admin address with get_admins before retrying.",
  },
  CannotRemoveLastAdmin: {
    description: "Cannot remove the last admin",
    cause: "Attempting to remove the only remaining admin, which would leave the contract without governance.",
    resolution: "Add a new admin before removing the existing one.",
  },
  TokenNotWhitelisted: {
    description: "Token is not whitelisted",
    cause: "Attempting to initialize or transact with a non-whitelisted token.",
    resolution: "Whitelist the token first or use an already-approved token.",
  },
  InvalidMigrationHash: {
    description: "Migration hash verification failed",
    cause: "Snapshot hash doesn't match the computed hash (data tampering or corruption).",
    resolution: "Re-export the migration snapshot and verify its integrity before retrying.",
  },
  MigrationInProgress: {
    description: "Migration already in progress or completed",
    cause: "Attempting to start a migration when one is already active.",
    resolution: "Wait for the current migration to finish, or check migration status.",
  },
  InvalidMigrationBatch: {
    description: "Migration batch out of order or invalid",
    cause: "Importing batches in the wrong order or with an invalid batch number.",
    resolution: "Import migration batches sequentially, starting from batch 0.",
  },
  CooldownActive: {
    description: "Cooldown period is still active",
    cause: "Attempting an action before its cooldown period has elapsed.",
    resolution: "Wait for the cooldown timer to expire before retrying.",
  },
  SuspiciousActivity: {
    description: "Suspicious activity detected",
    cause: "Pattern matching known abuse behaviors (rapid retries, unusual patterns).",
    resolution: "Reduce request frequency; contact support if this persists unexpectedly.",
  },
  ActionBlocked: {
    description: "Action temporarily blocked due to abuse protection",
    cause: "Multiple violations or severe abuse detected from the caller.",
    resolution: "Wait for the block to lift or contact an administrator to review the flag.",
  },
  Overflow: {
    description: "Arithmetic overflow detected",
    cause: "Result of an arithmetic operation exceeds the maximum representable value.",
    resolution: "Reduce the input amount(s); check for unreasonably large values.",
  },
  NetSettlementValidationFailed: {
    description: "Net settlement validation failed",
    cause: "Net settlement calculations don't match expected values.",
    resolution: "Recompute the netting batch inputs and resubmit.",
  },
  EscrowNotFound: {
    description: "Escrow record not found",
    cause: "Querying an escrow ID that doesn't exist.",
    resolution: "Verify the escrow ID from creation events before retrying.",
  },
  InvalidEscrowStatus: {
    description: "Invalid escrow status for this operation",
    cause: "Attempting an operation on an escrow in an incompatible status.",
    resolution: "Check the escrow's current status via get_escrow before retrying.",
  },
  SettlementCounterOverflow: {
    description: "Settlement counter overflow",
    cause: "The global settlement counter would exceed u64::MAX.",
    resolution: "Contact the maintainers; this indicates the contract needs a counter migration.",
  },
  InvalidBatchSize: {
    description: "Invalid batch size for batch operations",
    cause: "Provided batch size is zero or exceeds the configured maximum.",
    resolution: "Split the request into batches within the allowed size limit.",
  },
  DataCorruption: {
    description: "Data corruption detected in stored values",
    cause: "Integrity checks failed on stored contract data.",
    resolution: "Contact the maintainers; do not retry writes until the root cause is investigated.",
  },
  IndexOutOfBounds: {
    description: "Index out of bounds",
    cause: "Accessing a collection with an index outside its valid range.",
    resolution: "Verify the collection length before indexing into it.",
  },
  EmptyCollection: {
    description: "Collection is empty",
    cause: "The requested operation requires at least one element but the collection is empty.",
    resolution: "Ensure the collection is populated before calling this operation.",
  },
  KeyNotFound: {
    description: "Key not found in map",
    cause: "Lookup failed for a required key in a storage map.",
    resolution: "Verify the key exists via the corresponding getter before use.",
  },
  StringConversionFailed: {
    description: "String conversion failed",
    cause: "Invalid or malformed input during string conversion.",
    resolution: "Check the input encoding and length before submitting.",
  },
  InvalidSymbol: {
    description: "Invalid or malformed symbol string",
    cause: "Symbol exceeds length limits or contains invalid characters.",
    resolution: "Use a short, alphanumeric symbol consistent with Soroban's Symbol type.",
  },
  Underflow: {
    description: "Arithmetic underflow occurred",
    cause: "Result of an arithmetic operation is below the minimum representable value (e.g., subtracting more than available).",
    resolution: "Verify balances/amounts before performing the subtraction.",
  },
  NoPendingAdminTransfer: {
    description: "No pending admin transfer to accept",
    cause: "accept_admin() called when no propose_admin() has been issued.",
    resolution: "Have the current admin call propose_admin() first.",
  },
  IdempotencyConflict: {
    description: "Idempotency key conflict with different payload",
    cause: "The same idempotency key was reused with a different request payload.",
    resolution: "Use a new idempotency key for a differing request, or resend the exact original payload.",
  },
  InvalidProof: {
    description: "Proof validation failed",
    cause: "The submitted proof does not match the expected commitment.",
    resolution: "Regenerate the proof from the correct source data and resubmit.",
  },
  MissingProof: {
    description: "Proof is required but not provided",
    cause: "Calling a function that requires a proof without supplying one.",
    resolution: "Include the required proof parameter in the call.",
  },
  InvalidOracleAddress: {
    description: "Oracle address is invalid or not configured",
    cause: "The configured oracle address is unset or fails validation.",
    resolution: "Configure a valid oracle address via the admin function before use.",
  },
  AlreadyPaused: {
    description: "Contract is already paused",
    cause: "Calling emergency_pause when the contract is already in a paused state.",
    resolution: "No action required; verify with is_paused before pausing again.",
  },
  NotPaused: {
    description: "Contract is not currently paused",
    cause: "Calling an unpause or paused-only function while the contract is active.",
    resolution: "Verify the contract's paused state with is_paused before calling.",
  },
  OperationNotFound: {
    description: "Pending admin operation not found",
    cause: "Referencing a multi-sig operation ID that doesn't exist or already executed.",
    resolution: "Verify the operation ID from the proposal event before approving.",
  },
  AlreadyApproved: {
    description: "Caller has already approved this pending operation",
    cause: "The same admin calling approve_operation twice for the same operation.",
    resolution: "No action required; wait for other admins to approve.",
  },
  OperationExpired: {
    description: "Pending operation has exceeded its time-to-live",
    cause: "The operation's TTL elapsed before reaching the required approval threshold.",
    resolution: "Re-propose the operation to restart the approval window.",
  },
  InvalidMultiSigThreshold: {
    description: "Multi-sig threshold must be at least 1 and no greater than the admin count",
    cause: "Setting a threshold of 0 or greater than the current admin count.",
    resolution: "Choose a threshold between 1 and the current number of admins.",
  },
  AlreadyAdmin: {
    description: "Address is already in the admin set",
    cause: "Attempting to add an address that is already an admin.",
    resolution: "No action required; verify with get_admins.",
  },
  InsufficientAdmins: {
    description: "Removing this admin would drop the admin count below quorum or below 1",
    cause: "The remaining admin count after removal would violate the quorum requirement.",
    resolution: "Add another admin or lower the quorum before removing this one.",
  },
  InvalidQuorum: {
    description: "Quorum must be >= 1 and <= current admin count",
    cause: "Setting a quorum of 0 or greater than the current admin count.",
    resolution: "Choose a quorum value within the valid range for the current admin set.",
  },
  AlreadyVoted: {
    description: "Admin has already cast a vote on this proposal",
    cause: "The same admin calling vote() twice on the same proposal.",
    resolution: "No action required; wait for other admins to vote.",
  },
  InvalidProposalState: {
    description: "Proposal is not in the required state for this operation",
    cause: "Attempting to vote on, execute, or cancel a proposal that isn't in the expected lifecycle state.",
    resolution: "Check the proposal's current state via get_proposal before retrying.",
  },
  ProposalAlreadyPending: {
    description: "A fee-update proposal is already pending or approved",
    cause: "Attempting to create a new fee-update proposal while one is still active.",
    resolution: "Wait for the pending proposal to execute or be cancelled first.",
  },
  TimelockActive: {
    description: "Proposal timelock has not elapsed",
    cause: "Attempting to execute a proposal before its timelock period has passed.",
    resolution: "Wait until the timelock expires before executing the proposal.",
  },
  GovernanceAlreadyInitialized: {
    description: "Governance has already been initialized",
    cause: "Calling migrate_to_governance more than once.",
    resolution: "No action required; governance is already active.",
  },
  ProposalNotFound: {
    description: "Proposal with the given ID does not exist",
    cause: "Querying or voting on a proposal ID that was never created.",
    resolution: "Verify the proposal ID from the creation event before retrying.",
  },
  AgentAlreadyRegistered: {
    description: "Agent is already registered in the system",
    cause: "Attempting to register an agent address that's already on the whitelist.",
    resolution: "No action required; verify with get_agent.",
  },
  NotDisputed: {
    description: "This operation requires the remittance to be in a Disputed state",
    cause: "Calling a dispute-resolution function on a remittance that hasn't been disputed.",
    resolution: "Call raise_dispute first, or verify the remittance status.",
  },
  MalformedEvidenceHash: {
    description: "Evidence hash for a dispute is not a valid 32-byte SHA-256 commitment",
    cause: "Supplying an evidence hash that isn't exactly 32 bytes.",
    resolution: "Compute a SHA-256 hash of the evidence and pass the raw 32-byte digest.",
  },
};

function parseVariants(rsSource) {
  const enumMatch = rsSource.match(/pub enum ContractError \{([\s\S]*?)\n\}/);
  if (!enumMatch) {
    throw new Error("Could not locate `pub enum ContractError { ... }` in src/errors.rs");
  }
  const body = enumMatch[1];
  const variantRe = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(\d+)\s*,/gm;
  const variants = [];
  let m;
  while ((m = variantRe.exec(body)) !== null) {
    variants.push({ name: m[1], code: Number(m[2]) });
  }
  variants.sort((a, b) => a.code - b.code);
  return variants;
}

function buildTable(variants) {
  const missing = variants.filter((v) => !DETAILS[v.name]).map((v) => v.name);
  if (missing.length > 0) {
    throw new Error(
      `Missing Description/Common Cause/Resolution for variant(s): ${missing.join(", ")}. ` +
        `Add them to DETAILS in scripts/generate-error-table.js.`
    );
  }

  const header = "| Code | Name | Description | Common Cause | Resolution |";
  const divider = "| :--- | :--- | :--- | :--- | :--- |";
  const rows = variants.map((v) => {
    const d = DETAILS[v.name];
    return `| **${v.code}** | ${v.name} | ${d.description} | ${d.cause} | ${d.resolution} |`;
  });
  return [header, divider, ...rows].join("\n");
}

function main() {
  const rsSource = fs.readFileSync(ERRORS_RS, "utf8");
  const variants = parseVariants(rsSource);
  const table = buildTable(variants);

  const shouldWrite = process.argv.includes("--write");
  if (!shouldWrite) {
    process.stdout.write(table + "\n");
    return;
  }

  const readme = fs.readFileSync(README, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Could not find ${START_MARKER} / ${END_MARKER} markers in README.md`);
  }
  const before = readme.slice(0, startIdx + START_MARKER.length);
  const after = readme.slice(endIdx);
  const updated = `${before}\n\n${table}\n\n${after}`;
  fs.writeFileSync(README, updated);
  process.stdout.write(`Wrote ${variants.length} rows to README.md between the ERROR_TABLE markers.\n`);
}

main();
