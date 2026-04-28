# ProofOfPayout Component

## Overview

The `ProofOfPayout` component displays on-chain proof of completed remittance payouts by fetching and displaying contract events from the Stellar Horizon API. It shows transaction details including remittance ID, sender, agent, amount, fee, timestamp, and transaction hash, with a direct link to view the transaction on Stellar Expert.

## Features

- ✅ Fetches real event data from Horizon API
- ✅ Displays all transaction details (remittance ID, sender, agent, amount, fee, timestamp, transaction hash)
- ✅ Provides Stellar Expert link for transaction verification
- ✅ Loading and error state handling
- ✅ Responsive design with mobile support
- ✅ Optional camera capture functionality for proof of payout images
- ✅ Unit tests with mocked Horizon responses

## Usage

### Basic Usage (Display Only)

```tsx
import { ProofOfPayout } from './components/ProofOfPayout';

function App() {
  return <ProofOfPayout remittanceId={42} />;
}
```

### With Camera Capture

```tsx
import { ProofOfPayout } from './components/ProofOfPayout';

function App() {
  const handleRelease = async (remittanceId: number, proofImage: string) => {
    // Handle the proof image upload and fund release
    console.log('Releasing funds for remittance:', remittanceId);
    console.log('Proof image:', proofImage);
  };

  return <ProofOfPayout remittanceId={42} onRelease={handleRelease} />;
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `remittanceId` | `number` | Yes | The unique identifier of the remittance to fetch proof for |
| `onRelease` | `(remittanceId: number, proofImage: string) => Promise<void>` | No | Optional callback for camera capture mode. When provided, enables camera functionality |

## Environment Variables

The component requires the following environment variables to be set:

```env
VITE_HORIZON_URL=https://soroban-testnet.stellar.org
VITE_CONTRACT_ID=<your-contract-id>
```

## Event Structure

The component fetches two types of events from the Soroban contract:

### Settlement Completed Event

Topic: `("settle", "complete")`

Data structure:
```
[
  schema_version,    // u32
  ledger_sequence,   // u32
  timestamp,         // u64
  remittance_id,     // u64
  sender,            // Address
  agent,             // Address
  asset,             // Address
  amount             // i128
]
```

### Remittance Created Event (for fee lookup)

Topic: `("remit", "created")`

Data structure:
```
[
  schema_version,    // u32
  ledger_sequence,   // u32
  timestamp,         // u64
  remittance_id,     // u64
  sender,            // Address
  agent,             // Address
  amount,            // i128
  fee,               // i128
  integrator_fee     // i128
]
```

## HorizonService

The component uses the `HorizonService` class to interact with the Stellar Horizon API:

```typescript
import { horizonService } from './services/horizonService';

// Fetch completed event
const event = await horizonService.fetchCompletedEvent(42);

// Generate Stellar Expert link
const link = horizonService.getStellarExpertLink(transactionHash, 'testnet');
```

## Testing

Run the tests with:

```bash
npm test ProofOfPayout
```

The tests cover:
- Loading state display
- Successful event data fetching and display
- Error handling for network failures
- Error handling for missing events
- Stellar Expert link generation
- Address truncation
- Amount formatting from stroops
- Timestamp formatting
- Camera functionality (when onRelease is provided)

## Styling

The component uses `ProofOfPayout.css` for styling. Key CSS classes:

- `.proof-of-payout` - Main container
- `.loading-state` - Loading indicator
- `.error-state` - Error message display
- `.payout-details` - Transaction details container
- `.detail-row` - Individual detail row
- `.stellar-expert-link` - Link to Stellar Expert
- `.camera-container` - Camera capture interface (when enabled)

## Error Handling

The component handles the following error scenarios:

1. **Missing Contract ID**: Throws error if `VITE_CONTRACT_ID` is not configured
2. **Network Errors**: Displays user-friendly error message
3. **Event Not Found**: Shows message when no completed event exists for the remittance ID
4. **Camera Access**: Logs error if camera access is denied (when camera mode is enabled)

## Browser Compatibility

- Modern browsers with ES6+ support
- Camera functionality requires `getUserMedia` API support
- Tested on Chrome, Firefox, Safari, and Edge

## Future Enhancements

- [ ] Add pagination for multiple events
- [ ] Support for filtering by date range
- [ ] Export transaction details as PDF
- [ ] QR code generation for transaction hash
- [ ] Real-time event listening with WebSocket
