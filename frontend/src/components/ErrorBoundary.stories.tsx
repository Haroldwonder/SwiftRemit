import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import ErrorBoundary from './ErrorBoundary';

/** Helper component that throws on render when triggered */
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('💥 Simulated render error for Storybook');
  }
  return (
    <div style={{ padding: '1rem', border: '1px solid #22c55e', borderRadius: '8px' }}>
      ✅ Component rendered successfully — no error.
    </div>
  );
}

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Components/ErrorBoundary',
  component: ErrorBoundary,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Normal children — boundary is transparent */
export const Default: Story = {
  render: () => (
    <ErrorBoundary>
      <Bomb shouldThrow={false} />
    </ErrorBoundary>
  ),
};

/** Children that throw — boundary catches and shows fallback UI */
export const ErrorCaught: Story = {
  render: () => (
    <ErrorBoundary>
      <Bomb shouldThrow={true} />
    </ErrorBoundary>
  ),
};

/** Nested boundaries – inner catches its error, outer stays clean */
export const Nested: Story = {
  render: () => (
    <ErrorBoundary>
      <div>
        <p>Outer boundary (safe child below):</p>
        <ErrorBoundary>
          <Bomb shouldThrow={true} />
        </ErrorBoundary>
        <p>Outer boundary continues rendering here ✅</p>
      </div>
    </ErrorBoundary>
  ),
};
