import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { SkeletonLine, SkeletonBlock, SkeletonTable, SkeletonList } from './SkeletonLoader';

const meta: Meta = {
  title: 'Components/SkeletonLoader',
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;

/** Single skeleton line with default dimensions */
export const Line: StoryObj = {
  render: () => (
    <div style={{ width: '360px' }}>
      <SkeletonLine />
    </div>
  ),
};

/** Skeleton line with custom width */
export const LineNarrow: StoryObj = {
  name: 'Line – narrow',
  render: () => (
    <div style={{ width: '360px' }}>
      <SkeletonLine width="60%" height="0.875rem" />
    </div>
  ),
};

/** Skeleton block (card placeholder) */
export const Block: StoryObj = {
  render: () => (
    <div style={{ width: '360px' }}>
      <SkeletonBlock />
    </div>
  ),
};

/** Skeleton table with 5 rows (default) */
export const Table: StoryObj = {
  render: () => (
    <div style={{ width: '640px' }}>
      <SkeletonTable count={5} />
    </div>
  ),
};

/** Skeleton list */
export const List: StoryObj = {
  render: () => (
    <div style={{ width: '360px' }}>
      <SkeletonList count={4} />
    </div>
  ),
};

/** Composed skeleton card (simulates a transaction card loading) */
export const ComposedCard: StoryObj = {
  name: 'Composed – transaction card',
  render: () => (
    <div
      style={{
        width: '360px',
        padding: '1rem',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <SkeletonLine width="40%" height="1.25rem" />
        <SkeletonLine width="25%" height="1.25rem" borderRadius="9999px" />
      </div>
      <SkeletonLine width="70%" />
      <SkeletonLine width="50%" />
      <SkeletonLine width="30%" />
    </div>
  ),
};
