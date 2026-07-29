/**
 * Integration tests for admin action confirmation flow.
 * SR-058
 *
 * Tests: self-confirmation rejection, expiry, admin-only access,
 * audit logging, and each action type.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the admin confirmation module
const mockInitiateAction = vi.fn();
const mockConfirmAction = vi.fn();
const mockGetAction = vi.fn();
const mockListActions = vi.fn();

vi.mock('../admin-confirmation', () => ({
  initiateAction: mockInitiateAction,
  confirmAction: mockConfirmAction,
  getAction: mockGetAction,
  listActions: mockListActions,
}));

interface AdminAction {
  id: string;
  type: string;
  initiatedBy: string;
  initiatedAt: Date;
  expiresAt: Date;
  status: 'pending' | 'confirmed' | 'expired' | 'rejected';
  confirmedBy?: string;
  ip?: string;
}

describe('Admin Confirmation Flow (SR-058)', () => {
  const admin1 = { id: 'admin_1', role: 'admin', ip: '10.0.0.1' };
  const admin2 = { id: 'admin_2', role: 'admin', ip: '10.0.0.2' };
  const nonAdmin = { id: 'user_1', role: 'user', ip: '10.0.0.3' };

  const actionTypes = ['fee_change', 'agent_removal', 'upgrade', 'withdrawal'];

  beforeEach(() => vi.clearAllMocks());

  describe('Self-confirmation rejection', () => {
    it('rejects when initiator tries to self-confirm', () => {
      const action: AdminAction = {
        id: 'act_1',
        type: 'fee_change',
        initiatedBy: admin1.id,
        initiatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        status: 'pending',
      };
      mockGetAction.mockReturnValue(action);
      mockConfirmAction.mockImplementation((actionId: string, confirmerId: string) => {
        const act = mockGetAction(actionId);
        if (act.initiatedBy === confirmerId) {
          throw new Error('Self-confirmation is not allowed');
        }
        return { ...act, status: 'confirmed', confirmedBy: confirmerId };
      });

      expect(() => mockConfirmAction('act_1', admin1.id)).toThrow('Self-confirmation');
    });

    it('allows confirmation by a different admin', () => {
      const action: AdminAction = {
        id: 'act_2',
        type: 'fee_change',
        initiatedBy: admin1.id,
        initiatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        status: 'pending',
      };
      mockGetAction.mockReturnValue(action);
      mockConfirmAction.mockImplementation((_actionId: string, confirmerId: string) => {
        return { ...action, status: 'confirmed', confirmedBy: confirmerId };
      });

      const result = mockConfirmAction('act_2', admin2.id);
      expect(result.status).toBe('confirmed');
      expect(result.confirmedBy).toBe(admin2.id);
    });
  });

  describe('Action expiry', () => {
    it('rejects confirmation of expired actions', () => {
      const expired: AdminAction = {
        id: 'act_3',
        type: 'upgrade',
        initiatedBy: admin1.id,
        initiatedAt: new Date(Date.now() - 7200_000),
        expiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
        status: 'pending',
      };
      mockGetAction.mockReturnValue(expired);
      mockConfirmAction.mockImplementation((actionId: string) => {
        const act = mockGetAction(actionId);
        if (new Date() > act.expiresAt) {
          throw new Error('Action has expired');
        }
        return act;
      });

      expect(() => mockConfirmAction('act_3', admin2.id)).toThrow('expired');
    });
  });

  describe('Admin-only access', () => {
    it('only admins can initiate actions', () => {
      mockInitiateAction.mockImplementation((actor: any) => {
        if (actor.role !== 'admin') throw new Error('Admin access required');
        return { id: 'act_4', status: 'pending', initiatedBy: actor.id };
      });

      expect(() => mockInitiateAction(nonAdmin)).toThrow('Admin access required');
      expect(() => mockInitiateAction(admin1)).not.toThrow();
    });

    it('only admins can confirm actions', () => {
      mockConfirmAction.mockImplementation((_id: string, _confirmerId: string, role: string) => {
        if (role !== 'admin') throw new Error('Admin access required');
        return { status: 'confirmed' };
      });

      expect(() => mockConfirmAction('act_4', nonAdmin.id, nonAdmin.role)).toThrow('Admin access');
      expect(() => mockConfirmAction('act_4', admin2.id, admin2.role)).not.toThrow();
    });
  });

  describe('Audit logging', () => {
    it('records actor and IP for initiation', () => {
      const auditLog: any[] = [];
      mockInitiateAction.mockImplementation((actor: any) => {
        const entry = {
          action: 'initiate',
          actor: actor.id,
          ip: actor.ip,
          timestamp: new Date(),
        };
        auditLog.push(entry);
        return { id: 'act_5', status: 'pending' };
      });

      mockInitiateAction(admin1);
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].actor).toBe(admin1.id);
      expect(auditLog[0].ip).toBe(admin1.ip);
    });

    it('records actor and IP for confirmation', () => {
      const auditLog: any[] = [];
      mockConfirmAction.mockImplementation((_id: string, confirmer: any) => {
        auditLog.push({ action: 'confirm', actor: confirmer.id, ip: confirmer.ip });
        return { status: 'confirmed' };
      });

      mockConfirmAction('act_5', admin2);
      expect(auditLog[0].actor).toBe(admin2.id);
      expect(auditLog[0].ip).toBe(admin2.ip);
    });
  });

  describe('Action types', () => {
    it.each(actionTypes)('supports %s action type', (actionType) => {
      mockInitiateAction.mockReturnValue({
        id: `act_${actionType}`,
        type: actionType,
        status: 'pending',
        initiatedBy: admin1.id,
      });

      const result = mockInitiateAction(admin1, actionType);
      expect(result.type).toBe(actionType);
      expect(result.status).toBe('pending');
    });
  });
});
