import React, { useState } from 'react';

export interface Agent {
  address: string;
  name: string;
  isActive: boolean;
  totalProcessed: number;
  successRate: number;
  corridors: string[];
}

export interface AgentPanelProps {
  agents?: Agent[];
  isAdmin?: boolean;
  onRegister?: (address: string) => void;
  onDeactivate?: (address: string) => void;
  onReactivate?: (address: string) => void;
}

export function AgentPanel({
  agents = [],
  isAdmin = false,
  onRegister,
  onDeactivate,
  onReactivate,
}: AgentPanelProps) {
  const [newAddress, setNewAddress] = useState('');
  const [registerError, setRegisterError] = useState('');

  const handleRegister = () => {
    if (!newAddress.startsWith('G') || newAddress.length !== 56) {
      setRegisterError('Invalid Stellar address');
      return;
    }
    setRegisterError('');
    onRegister?.(newAddress);
    setNewAddress('');
  };

  const activeAgents = agents.filter((a) => a.isActive);
  const inactiveAgents = agents.filter((a) => !a.isActive);

  return (
    <div className="agent-panel" data-testid="agent-panel">
      <h2>Agent Management</h2>

      <div className="agent-stats" data-testid="agent-stats">
        <div className="stat">
          <span className="stat-value">{agents.length}</span>
          <span className="stat-label">Total Agents</span>
        </div>
        <div className="stat">
          <span className="stat-value">{activeAgents.length}</span>
          <span className="stat-label">Active</span>
        </div>
        <div className="stat">
          <span className="stat-value">{inactiveAgents.length}</span>
          <span className="stat-label">Inactive</span>
        </div>
      </div>

      {isAdmin && (
        <div className="register-agent" data-testid="register-agent-form">
          <h3>Register New Agent</h3>
          <div className="input-group">
            <label htmlFor="agent-address">Stellar Address</label>
            <input
              id="agent-address"
              type="text"
              value={newAddress}
              onChange={(e) => {
                setNewAddress(e.target.value);
                setRegisterError('');
              }}
              placeholder="G..."
              data-testid="agent-address-input"
            />
            {registerError && (
              <p className="error" role="alert" data-testid="register-error">
                {registerError}
              </p>
            )}
          </div>
          <button
            onClick={handleRegister}
            className="btn-primary"
            data-testid="register-btn"
          >
            Register Agent
          </button>
        </div>
      )}

      <div className="agent-list" data-testid="agent-list">
        {agents.length === 0 ? (
          <p className="empty-state">No agents registered yet.</p>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.address}
              className={`agent-card ${agent.isActive ? 'agent-card--active' : 'agent-card--inactive'}`}
              data-testid={`agent-card-${agent.address}`}
            >
              <div className="agent-header">
                <h4 className="agent-name">{agent.name}</h4>
                <span
                  className={`agent-status ${agent.isActive ? 'status-active' : 'status-inactive'}`}
                >
                  {agent.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="agent-address" title={agent.address}>
                {agent.address.slice(0, 12)}…{agent.address.slice(-8)}
              </p>
              <div className="agent-metrics">
                <span>
                  Processed:{' '}
                  <strong>{agent.totalProcessed.toLocaleString()}</strong>
                </span>
                <span>
                  Success rate:{' '}
                  <strong>{(agent.successRate * 100).toFixed(1)}%</strong>
                </span>
              </div>
              <div className="agent-corridors">
                {agent.corridors.map((c) => (
                  <span key={c} className="corridor-tag">
                    {c}
                  </span>
                ))}
              </div>
              {isAdmin && (
                <div className="agent-actions">
                  {agent.isActive ? (
                    <button
                      onClick={() => onDeactivate?.(agent.address)}
                      className="btn-danger btn-sm"
                      data-testid={`deactivate-${agent.address}`}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => onReactivate?.(agent.address)}
                      className="btn-secondary btn-sm"
                      data-testid={`reactivate-${agent.address}`}
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
