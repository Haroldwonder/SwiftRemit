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
