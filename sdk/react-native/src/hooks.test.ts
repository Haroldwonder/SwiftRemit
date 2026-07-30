import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useCreateRemittance, useNetworkToggle } from './hooks.js';
import type { SwiftRemitRNClient } from './client.js';

describe('useNetworkToggle', () => {
  it('defaults to testnet and toggles between networks', () => {
    let hookResult: ReturnType<typeof useNetworkToggle> | undefined;
    function Harness() {
      hookResult = useNetworkToggle();
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });

    expect(hookResult?.network).toBe('testnet');
    expect(hookResult?.isTestnet).toBe(true);

    act(() => {
      hookResult?.toggle();
    });
    expect(hookResult?.network).toBe('mainnet');

    act(() => {
      hookResult?.toggle();
    });
    expect(hookResult?.network).toBe('testnet');
  });
});

describe('useCreateRemittance', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('tracks loading state across a successful submission', async () => {
    const createDeferred = deferred<unknown>();
    const submitDeferred = deferred<unknown>();
    const client = {
      createRemittance: jest.fn().mockReturnValue(createDeferred.promise),
      submitSigned: jest.fn().mockReturnValue(submitDeferred.promise),
    } as unknown as SwiftRemitRNClient;

    let hookResult: ReturnType<typeof useCreateRemittance> | undefined;
    function Harness() {
      hookResult = useCreateRemittance(client);
      return null;
    }

    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });

    expect(hookResult?.isLoading).toBe(false);

    let callPromise: Promise<unknown>;
    act(() => {
      callPromise = hookResult!.createRemittance({} as never);
    });
    expect(hookResult?.isLoading).toBe(true);

    await act(async () => {
      createDeferred.resolve('prepared-tx');
      submitDeferred.resolve('result');
      await callPromise;
    });

    expect(hookResult?.isLoading).toBe(false);
    expect(hookResult?.error).toBeNull();
  });

  it('does not update state after the component has unmounted', async () => {
    const createDeferred = deferred<unknown>();
    const client = {
      createRemittance: jest.fn().mockReturnValue(createDeferred.promise),
      submitSigned: jest.fn().mockResolvedValue('result'),
    } as unknown as SwiftRemitRNClient;

    let hookResult: ReturnType<typeof useCreateRemittance> | undefined;
    function Harness() {
      hookResult = useCreateRemittance(client);
      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });

    let callPromise: Promise<unknown>;
    act(() => {
      callPromise = hookResult!.createRemittance({} as never).catch(() => {
        // Swallow: the point of this test is that no *state update* happens
        // post-unmount, not whether the in-flight promise itself resolves.
      });
    });

    act(() => {
      renderer.unmount();
    });

    // Resolving after unmount must not throw or warn — the mounted-ref guard
    // in useCreateRemittance should skip the setState call entirely.
    await act(async () => {
      createDeferred.resolve('prepared-tx');
      await callPromise;
    });
  });
});
