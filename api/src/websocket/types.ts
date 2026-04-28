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
  /** Remittance IDs this user is allowed to watch */
  remittanceIds?: string[];
}
