# Integrating Stellar Wallets Kit with React for Smart Contract Interactions

This guide provides a comprehensive, step-by-step approach to integrating the Stellar Wallets Kit into a React application for connecting to Stellar smart contracts (Soroban). It covers environment setup, provider configuration, wallet connection logic, transaction signing, and contract function interactions. The implementation emphasizes React best practices, including hooks for state management and asynchronous patterns for seamless user experiences.

## 1. Environment Setup and Dependencies

### Prerequisites
- Node.js (v16 or later)
- A Stellar account with testnet funds for development
- Freighter wallet extension installed and configured for Stellar/Soroban networks

### Installing Dependencies
Install the necessary packages using npm or yarn:

```bash
npm install @creit.tech/stellar-wallets-kit @stellar/stellar-sdk @soroban-react/core @soroban-react/freighter react react-dom
```

- `@creit.tech/stellar-wallets-kit`: Unified API for multiple Stellar wallets
- `@stellar/stellar-sdk`: Core Stellar SDK for Soroban contract interactions
- `@soroban-react/core`: React context and hooks for Soroban dApps
- `@soroban-react/freighter`: Freighter wallet connector

### Project Structure
Create a basic React structure:

```
src/
├── components/
│   ├── WalletConnectButton.jsx
│   └── ContractInteraction.jsx
├── hooks/
│   └── useWallet.js
├── contexts/
│   └── WalletProvider.jsx
├── utils/
│   └── contractHelpers.js
└── App.jsx
```

## 2. Configuring the Stellar Wallets Kit Provider

Wrap your application with the Soroban React provider to manage wallet connections and network state. This provider uses the Stellar Wallets Kit under the hood for multi-wallet support.

```jsx
// src/contexts/WalletProvider.jsx
import React from 'react';
import { SorobanReactProvider } from '@soroban-react/core';
import { freighter } from '@soroban-react/freighter';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';

const chains = [
  {
    id: 'testnet',
    name: 'Testnet',
    networkPassphrase: WalletNetwork.TESTNET,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  },
  {
    id: 'mainnet',
    name: 'Mainnet',
    networkPassphrase: WalletNetwork.PUBLIC,
    sorobanRpcUrl: 'https://soroban-rpc.mainnet.stellar.org',
  },
];

const connectors = [freighter()];

export function WalletProvider({ children }) {
  const activeChain = chains[0]; // Default to testnet

  return (
    <SorobanReactProvider
      chains={chains}
      appName="Your Soroban dApp"
      connectors={connectors}
      activeChain={activeChain}
    >
      {children}
    </SorobanReactProvider>
  );
}
```

Update your main App component:

```jsx
// src/App.jsx
import React from 'react';
import { WalletProvider } from './contexts/WalletProvider';
import WalletConnectButton from './components/WalletConnectButton';
import ContractInteraction from './components/ContractInteraction';

function App() {
  return (
    <WalletProvider>
      <div className="App">
        <WalletConnectButton />
        <ContractInteraction />
      </div>
    </WalletProvider>
  );
}

export default App;
```

## 3. Implementing Wallet Connection Logic

Create a custom hook to manage wallet connection state and the Stellar Wallets Kit instance.

```jsx
// src/hooks/useWallet.js
import { useState, useEffect, useCallback } from 'react';
import { useSorobanReact } from '@soroban-react/core';
import { StellarWalletsKit, WalletNetwork, allowAllModules } from '@creit.tech/stellar-wallets-kit';

export function useWallet() {
  const sorobanContext = useSorobanReact();
  const [walletKit, setWalletKit] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET, // Or PUBLIC for mainnet
      modules: allowAllModules(),
    });
    setWalletKit(kit);
  }, []);

  const connect = useCallback(async () => {
    if (!walletKit) return;

    setConnecting(true);
    setError(null);

    try {
      await walletKit.openModal({
        onWalletSelected: async (option) => {
          await walletKit.setWallet(option.id);
          setIsConnected(true);
          // Update soroban context if needed
          sorobanContext.connect(option.id);
        },
        onWalletUnselected: () => {
          setIsConnected(false);
          sorobanContext.disconnect();
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }, [walletKit, sorobanContext]);

  const disconnect = useCallback(async () => {
    if (!walletKit) return;

    try {
      await walletKit.disconnect();
      setIsConnected(false);
      sorobanContext.disconnect();
    } catch (err) {
      setError(err.message);
    }
  }, [walletKit, sorobanContext]);

  return {
    walletKit,
    isConnected,
    connecting,
    error,
    connect,
    disconnect,
  };
}
```

Now, implement the connect button component:

```jsx
// src/components/WalletConnectButton.jsx
import React from 'react';
import { useWallet } from '../hooks/useWallet';

export default function WalletConnectButton() {
  const { isConnected, connecting, error, connect, disconnect } = useWallet();

  const handleClick = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  return (
    <div>
      <button onClick={handleClick} disabled={connecting}>
        {connecting ? 'Connecting...' : isConnected ? 'Disconnect' : 'Connect Wallet'}
      </button>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {isConnected && <p>Wallet connected successfully!</p>}
    </div>
  );
}
```

## 4. Handling Transaction Signing

For transaction signing, use the wallet kit's `signTransaction` method. Implement error handling for rejected transactions and loading states.

```jsx
// src/hooks/useWallet.js (add to existing hook)
export function useWallet() {
  // ... existing code ...

  const signTransaction = useCallback(async (transaction) => {
    if (!walletKit || !isConnected) {
      throw new Error('Wallet not connected');
    }

    try {
      const { signedTxXdr } = await walletKit.signTransaction(transaction.toXDR(), {
        address: sorobanContext.address,
        networkPassphrase: sorobanContext.activeChain.networkPassphrase,
      });
      return signedTxXdr;
    } catch (err) {
      if (err.message.includes('rejected')) {
        throw new Error('Transaction rejected by user');
      }
      throw err;
    }
  }, [walletKit, isConnected, sorobanContext]);

  return {
    // ... existing returns ...
    signTransaction,
  };
}
```

## 5. Interacting with Smart Contract Functions

Create utilities for contract interactions and a component to demonstrate usage.

```jsx
// src/utils/contractHelpers.js
import { Contract } from '@stellar/stellar-sdk';

export function createContract(contractId, sorobanContext) {
  return new Contract(contractId);
}

export async function callContractFunction(contract, functionName, args, sorobanContext, signTransaction) {
  const account = await sorobanContext.server.getAccount(sorobanContext.address);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: sorobanContext.activeChain.networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build();

  const signedXdr = await signTransaction(transaction);
  const signedTransaction = TransactionBuilder.fromXDR(signedXdr, sorobanContext.activeChain.networkPassphrase);

  const result = await sorobanContext.server.sendTransaction(signedTransaction);
  return result;
}
```

Implement the contract interaction component:

```jsx
// src/components/ContractInteraction.jsx
import React, { useState } from 'react';
import { useSorobanReact } from '@soroban-react/core';
import { useWallet } from '../hooks/useWallet';
import { createContract, callContractFunction } from '../utils/contractHelpers';
import { scvalToBigInt, xdr } from '@stellar/stellar-sdk';

const CONTRACT_ID = 'your-deployed-contract-id'; // Replace with actual contract ID

export default function ContractInteraction() {
  const sorobanContext = useSorobanReact();
  const { isConnected, signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [inputValue, setInputValue] = useState('');

  const handleContractCall = async (functionName, args = []) => {
    if (!isConnected) {
      setError('Wallet not connected');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const contract = createContract(CONTRACT_ID, sorobanContext);
      const callResult = await callContractFunction(contract, functionName, args, sorobanContext, signTransaction);

      if (callResult.status === 'PENDING') {
        // Wait for transaction to be processed
        const processedResult = await sorobanContext.server.getTransaction(callResult.hash);
        setResult(processedResult.returnValue ? scvalToBigInt(processedResult.returnValue) : 'Success');
      } else {
        setResult(callResult.status);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetValue = () => {
    const value = xdr.ScVal.scvU64(BigInt(inputValue));
    handleContractCall('set', [xdr.ScVal.scvSymbol('key'), value]);
  };

  const handleGetValue = () => {
    handleContractCall('get', [xdr.ScVal.scvSymbol('key')]);
  };

  return (
    <div>
      <h2>Contract Interaction</h2>
      {!isConnected && <p>Please connect your wallet first.</p>}
      {isConnected && (
        <>
          <div>
            <input
              type="number"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter value to set"
            />
            <button onClick={handleSetValue} disabled={loading}>
              {loading ? 'Setting...' : 'Set Value'}
            </button>
          </div>
          <div>
            <button onClick={handleGetValue} disabled={loading}>
              {loading ? 'Getting...' : 'Get Value'}
            </button>
          </div>
          {result && <p>Result: {result.toString()}</p>}
          {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        </>
      )}
    </div>
  );
}
```

## 6. Edge Cases and Best Practices

### Connection State Management
- Use the `isConnected` state to conditionally render UI elements
- Implement automatic reconnection on page refresh using localStorage to persist connection state
- Handle network switching by updating the wallet kit's network parameter

### Error Handling
- Catch and display user-friendly error messages for common scenarios (e.g., insufficient funds, network errors)
- Implement retry logic for transient failures
- Log errors for debugging while showing generic messages to users

### Loading States
- Show loading indicators during async operations (wallet connection, transaction signing, contract calls)
- Disable buttons during loading to prevent multiple submissions
- Use optimistic updates for better UX, reverting on failure

### Security Considerations
- Never store private keys or sensitive data in localStorage
- Validate all user inputs before sending to contracts
- Implement proper error boundaries to prevent app crashes

### Performance Optimization
- Memoize expensive contract calls using `useMemo`
- Debounce rapid user inputs to reduce unnecessary API calls
- Implement caching for frequently accessed contract data

This implementation provides a solid foundation for integrating Stellar Wallets Kit with Soroban smart contracts in React applications. Adapt the contract-specific logic to your particular smart contract's functions and data types.