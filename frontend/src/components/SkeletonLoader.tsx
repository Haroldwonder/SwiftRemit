import React from 'react';
import './SkeletonLoader.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  count?: number;
  className?: string;
}

export function SkeletonLine({
  width = '100%',
  height = '1rem',
  borderRadius = '4px',
  className = '',
}: SkeletonProps): React.ReactElement {
  return (
    <div
      className={`skeleton-line ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
}

export function SkeletonBlock({
  width = '100%',
  height = '6rem',
  borderRadius = '8px',
  className = '',
}: SkeletonProps): React.ReactElement {
  return (
    <div
      className={`skeleton-block ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
}

export function SkeletonTable({ count = 5 }: SkeletonProps): React.ReactElement {
  return (
    <div className="skeleton-table">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-table-row">
          <SkeletonLine width="20%" />
          <SkeletonLine width="15%" />
          <SkeletonLine width="15%" />
          <SkeletonLine width="25%" />
          <SkeletonLine width="15%" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ count = 3 }: SkeletonProps): React.ReactElement {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-list-item">
          <SkeletonBlock width="100%" height="4rem" />
        </div>
      ))}
    </div>
  );
}

export default SkeletonLine;
