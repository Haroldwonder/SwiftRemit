/**
 * Shared types for the WebSocket layer.
 */

/** Mirrors the on-chain RemittanceStatus enum from src/types.rs */
export type RemittanceStatus =
  | 'Pending'
  | 'Processing'
  | 'Completed'
  | 'Cancelled'
  | 'Failed'
  | 'Disputed';

/** Payload emitted to clients on every status change */
export interface StatusUpdatedPayload {
  remittanceId: string;
  status: RemittanceStatus;
  updatedAt: string; // ISO 8601
}

/** Shape of the decoded JWT used for WebSocket auth */
export interface AuthenticatedUser {
  userId: string;
  /** Remittance IDs this user is allowed to watch as sender */
  remittanceIds?: string[];
  /** Remittance IDs this user is assigned to as agent */
  agentRemittanceIds?: string[];
  /** User role — 'agent' grants access to remittances where the user is the assigned agent */
  role?: string;
}

/**
 * Agent reputation dispute stats mirrored from on-chain state.
 * disputesLost is tracked separately from dispute_count so that
 * disputes resolved in the agent's favour do not penalise reputation.
 * Time decay is applied via lastDisputeAt: older losses weigh less.
 */
export interface AgentDisputeStats {
  agentId: string;
  /** Total disputes raised against this agent (raw count) */
  disputeCount: number;
  /** Disputes resolved against this agent */
  disputesLost: number;
  /** Disputes resolved in this agent's favour */
  disputesWon: number;
  /** ISO 8601 timestamp of the most recent lost dispute, if any */
  lastDisputeLostAt?: string;
}
