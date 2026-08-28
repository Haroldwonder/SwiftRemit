/**
 * Remittance Events
 *
 * Event emitter for remittance status changes.
 * Integrates with webhook system to notify subscribers.
 *
 * This is a derived-status emitter (pending/processing/completed/failed/cancelled), not a
 * raw on-chain topic listener. For the full catalogue of contract events — topics, payload
 * shapes, and schema version — see ../../../docs/EVENTS.md.
 *
 * SR-035: The originating correlation ID is threaded from every emitStatusChange call
 * through to webhook delivery, contract-event DB writes, and WebSocket pushes.
 * Callers that already hold a correlation ID in AsyncLocalStorage can omit the
 * explicit parameter; getCorrelationId() is used as the automatic fallback.
 */

import { EventEmitter } from 'events';
import { RemittanceData } from '../webhooks/types';
import { WebhookService } from '../webhooks/service';
import { AdminAuditLogService } from '../admin-audit-log';
import { NotificationService } from '../notification-service';
import { getCorrelationId, createLogger } from '../correlation-id';

const logger = createLogger('remittance-events');

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
  /** Originating correlation ID — propagated to webhooks, DB writes, and WS pushes. */
  correlationId?: string;
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
 * Handles remittance status changes and triggers webhooks.
 */
export class RemittanceEventEmitter extends EventEmitter {
  private webhookService?: WebhookService;
  private auditLogService?: AdminAuditLogService;
  private notificationService?: NotificationService;

  setWebhookService(webhookService: WebhookService): void {
    this.webhookService = webhookService;
  }

  setAuditLogService(auditLogService: AdminAuditLogService): void {
    this.auditLogService = auditLogService;
  }

  /**
   * Wired at app startup so status changes actually reach the user by email
   * / SMS. Before this, NotificationService.notifyRemittanceStatus() existed
   * (SR-035 localized templates included) but was never called from anywhere
   * in the emitter, so remittance completion/failure never produced an
   * outbound notification.
   */
  setNotificationService(notificationService: NotificationService): void {
    this.notificationService = notificationService;
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
          ip_address: null,
        });
      } catch (err) {
        logger.error('Failed to write admin audit log entry', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /**
   * Emit remittance status change event.
   *
   * The correlation ID is resolved in priority order:
   *   1. event.correlationId   (explicitly supplied by the caller)
   *   2. getCorrelationId()     (ambient ALS value — set by HTTP middleware or job-tracker)
   *
   * The resolved ID is forwarded to:
   *   - the webhook dispatcher (appears in payload + X-Correlation-ID header)
   *   - every listener of 'status-changed' via the event object
   */
  async emitStatusChange(event: RemittanceStatusChangeEvent): Promise<void> {
    // Resolve the correlation ID for this hop
    const correlationId = event.correlationId ?? getCorrelationId();

    // Propagate resolved ID back into the event so downstream listeners have it
    const enrichedEvent: RemittanceStatusChangeEvent = { ...event, correlationId };

    logger.info('Remittance status changed', {
      remittanceId: event.remittanceId,
      status: event.status,
      correlationId,
    });

    // Emit local event for any local listeners
    this.emit('status-changed', enrichedEvent);
    this.emit(`status-${event.status}`, enrichedEvent);

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
          },
          correlationId,
        );

        if (result.failed > 0) {
          logger.warn(`Webhook delivery partial failure`, {
            remittanceId: event.remittanceId,
            success: result.success,
            failed: result.failed,
            correlationId,
          });
        } else {
          logger.info(`Webhooks delivered`, {
            remittanceId: event.remittanceId,
            subscribers: result.success,
            correlationId,
          });
        }
      } catch (error) {
        logger.error(
          `Failed to trigger webhooks for remittance ${event.remittanceId}`,
          error instanceof Error ? error : new Error(String(error)),
          { correlationId },
        );
        // Don't throw — webhook delivery is best-effort
      }
    }

    // Notify the user by email/SMS on terminal status changes. Best-effort,
    // same as the webhook fan-out above: notification delivery must never
    // block or fail the status-change flow that triggered it.
    if (this.notificationService && (event.status === 'completed' || event.status === 'failed')) {
      try {
        await this.notificationService.notifyRemittanceStatus({
          remittanceId: event.remittanceId,
          status: event.status,
          amount: event.amount,
          currency: event.currency,
          // recipientId is the only party identifier carried on this event;
          // it is used as the notified user until a distinct sender user ID
          // is threaded through the remittance-creation path.
          senderUserId: event.recipientId,
        });
      } catch (error) {
        logger.error(
          `Failed to send status notification for remittance ${event.remittanceId}`,
          error instanceof Error ? error : new Error(String(error)),
          { correlationId },
        );
      }
    }
  }

  /** Listen for remittance created events */
  onRemittanceCreated(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-pending', callback);
  }

  /** Listen for remittance processing events */
  onRemittanceProcessing(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-processing', callback);
  }

  /** Listen for remittance completed events */
  onRemittanceCompleted(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-completed', callback);
  }

  /** Listen for remittance failed events */
  onRemittanceFailed(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-failed', callback);
  }

  /** Listen for remittance cancelled events */
  onRemittanceCancelled(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-cancelled', callback);
  }

  /** Listen for any status change */
  onStatusChange(callback: (event: RemittanceStatusChangeEvent) => void): void {
    this.on('status-changed', callback);
  }
}

// Create global singleton instance
export const remittanceEventEmitter = new RemittanceEventEmitter();

/**
 * Helper function to update remittance status.
 * Pass correlationId explicitly when calling from outside an ALS context.
 */
export async function updateRemittanceStatus(
  remittanceId: string,
  status: RemittanceData['status'],
  remittanceData: Omit<RemittanceStatusChangeEvent, 'remittanceId' | 'status' | 'timestamp'>,
): Promise<void> {
  await remittanceEventEmitter.emitStatusChange({
    remittanceId,
    status,
    ...remittanceData,
    timestamp: new Date(),
  });
}
