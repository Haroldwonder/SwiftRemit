/**
 * Remittance Events
 * 
 * Event emitter for remittance status changes.
 * Integrates with webhook system to notify subscribers.
 */

import { EventEmitter } from 'events';
import { RemittanceData } from '../webhooks/types';
import { WebhookService } from '../webhooks/service';
import { AdminAuditLogService } from '../admin-audit-log';

export interface RemittanceStatusChangeEvent {
  remittanceId: string;
  status: RemittanceData['status'];
  previousStatus?: RemittanceData['status'];
  amount: number;
  currency: string;
  sourceCurrency?: string;
  recipientId: string;
  reason?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

/** Admin actions that should be written to the audit log. */
export interface AdminActionEvent {
  adminAddress: string;
  action: string;
  target?: string;
  params?: Record<string, unknown>;
  txHash?: string;
}

/**
 * Remittance Event Emitter
 * 
 * Handles remittance status changes and triggers webhooks
 */
export class RemittanceEventEmitter extends EventEmitter {
  private webhookService?: WebhookService;
  private auditLogService?: AdminAuditLogService;

  setWebhookService(webhookService: WebhookService): void {
    this.webhookService = webhookService;
  }

  setAuditLogService(auditLogService: AdminAuditLogService): void {
    this.auditLogService = auditLogService;
  }

  /** Emit an admin action and persist it to the audit log. */
  async emitAdminAction(event: AdminActionEvent): Promise<void> {
    this.emit('admin-action', event);
    if (this.auditLogService) {
      try {
        await this.auditLogService.log({
          admin_address: event.adminAddress,
          action: event.action,
          target: event.target ?? null,
          params_json: event.params ?? null,
          tx_hash: event.txHash ?? null,
        });
      } catch (err) {
        console.error('Failed to write admin audit log entry:', err);
      }
    }
  }

  /**
   * Emit remittance status change event
   */
  async emitStatusChange(event: RemittanceStatusChangeEvent): Promise<void> {
    // Emit local event for any local listeners
    this.emit('status-changed', event);
    this.emit(`status-${event.status}`, event);

    // Trigger webhooks if service is configured
    if (this.webhookService) {
      try {
        const result = await this.webhookService.onRemittanceStatusChange(
          event.remittanceId,
          event.status,
          {
            amount: event.amount,
            currency: event.currency,
            sourceCurrency: event.sourceCurrency,
            recipientId: event.recipientId,
            reason: event.reason,
            metadata: event.metadata,
            createdAt: event.timestamp.toISOString(),
            updatedAt: event.timestamp.toISOString(),
          }
        );

        if (result.failed > 0) {
          console.warn(
            `Webhook delivery: ${result.success} succeeded, ${result.failed} failed for remittance ${event.remittanceId}`
          );
        } else {
          console.info(
            `Webhooks triggered for remittance ${event.remittanceId}: ${result.success} subscribers notified`
          );
        }
      } catch (error) {
        console.error(`Failed to trigger webhooks for remittance ${event.remittanceId}:`, error);
        // Don't throw - webhook delivery is best-effort
      }
    }
  }

  /**
   * Listen for remittance created events
   */
  onRemittanceCreated(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-pending', callback);
  }

  /**
   * Listen for remittance processing events
   */
  onRemittanceProcessing(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-processing', callback);
  }

  /**
   * Listen for remittance completed events
   */
  onRemittanceCompleted(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-completed', callback);
  }

  /**
   * Listen for remittance failed events
   */
  onRemittanceFailed(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-failed', callback);
  }

  /**
   * Listen for remittance cancelled events
   */
  onRemittanceCancelled(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-cancelled', callback);
  }

  /**
   * Listen for any status change
   */
  onStatusChange(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-changed', callback);
  }
}

// Create global singleton instance
export const remittanceEventEmitter = new RemittanceEventEmitter();

/**
 * Helper function to update remittance status
 */
export async function updateRemittanceStatus(
  remittanceId: string,
  status: RemittanceData['status'],
  remittanceData: Omit<RemittanceStatusChangeEvent, 'remittanceId' | 'status' | 'timestamp'>
): Promise<void> {
  await remittanceEventEmitter.emitStatusChange({
    remittanceId,
    status,
    ...remittanceData,
    timestamp: new Date(),
  });
}
