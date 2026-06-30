import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SendMoneyFlow } from '../components/SendMoneyFlow';

describe('SendMoneyFlow snapshots', () => {
  it('renders initial amount step with default balance', () => {
    const { container } = render(<SendMoneyFlow />);
    expect(container).toMatchSnapshot();
  });

  it('renders with available balance', () => {
    const { container } = render(<SendMoneyFlow availableBalance={1500.75} />);
    expect(container).toMatchSnapshot();
  });

  it('renders with zero balance', () => {
    const { container } = render(
      <SendMoneyFlow availableBalance={0} onCancel={vi.fn()} />,
    );
    expect(container).toMatchSnapshot();
  });

  it('renders with onComplete and onCancel callbacks bound', () => {
    const { container } = render(
      <SendMoneyFlow
        availableBalance={500}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});
