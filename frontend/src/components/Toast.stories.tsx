import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { ToastContainer, useToast } from './Toast';
import type { ToastType } from './Toast';

// ── Helper wrapper so we can drive the hook from story controls ──────────────
function ToastDemo({ type, message }: { type: ToastType; message: string }) {
  const { toasts, showToast, dismissToast } = useToast();
  return (
    <div style={{ padding: '1rem' }}>
      <button
        type="button"
        onClick={() => showToast(message, type)}
        style={{ padding: '8px 16px', minHeight: '44px', minWidth: '44px' }}
      >
        Show {type} toast
      </button>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function AllToastsDemo() {
  const { toasts, showToast, dismissToast } = useToast();
  return (
    <div style={{ padding: '1rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {(['success', 'error', 'info', 'warning'] as ToastType[]).map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => showToast(`This is a ${type} notification`, type)}
          style={{ padding: '8px 16px', minHeight: '44px', minWidth: '44px' }}
        >
          {type}
        </button>
      ))}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function PersistentToastDemo() {
  const { toasts, showToast, dismissToast } = useToast();
  return (
    <div style={{ padding: '1rem' }}>
      <button
        type="button"
        onClick={() => showToast('This toast stays until dismissed', 'warning', 0)}
        style={{ padding: '8px 16px', minHeight: '44px', minWidth: '44px' }}
      >
        Show persistent toast
      </button>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

const meta: Meta = {
  title: 'Components/Toast',
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;

export const Success: StoryObj = {
  render: () => <ToastDemo type="success" message="Transaction submitted successfully!" />,
};

export const Error: StoryObj = {
  render: () => <ToastDemo type="error" message="Transaction failed. Please try again." />,
};

export const Info: StoryObj = {
  render: () => <ToastDemo type="info" message="Your session will expire in 5 minutes." />,
};

export const Warning: StoryObj = {
  render: () => <ToastDemo type="warning" message="Approaching daily transfer limit." />,
};

export const AllTypes: StoryObj = {
  name: 'All types',
  render: () => <AllToastsDemo />,
};

export const Persistent: StoryObj = {
  name: 'Persistent (no auto-dismiss)',
  render: () => <PersistentToastDemo />,
};
