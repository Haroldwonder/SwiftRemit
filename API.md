# SwiftRemit API Reference

Complete API documentation for the SwiftRemit smart contract.

## REST API Endpoints

### POST /api/simulate-settlement

Simulates a settlement to preview fees and payout amount before confirming. No state changes are made.

**Request Body:**
```json
{ "remittanceId": 1 }
```

**Validation:**
- `remittanceId` must be a positive integer

**Response 200:**
```json
{
  "would_succeed": true,
  "payout_amount": "9750",
  "fee": "250",
  "error_message": null
}
```

**Response 400** — invalid input:
```json
{ "error": "remittanceId must be a positive integer" }
```

**Response 500** — contract or network error:
```json
{ "error": "Failed to simulate settlement" }
```

---

## Contract Functions

### New and Updated Functions

#### `set_daily_limit(currency, country, limit)`

Set an admin-managed rolling 24h send limit for a currency/country pair.

**Authorization:** Admin only

**Parameters:**
- `currency: String`
- `country: String`
- `limit: i128`

**Returns:** `Result<(), ContractError>`

**Errors:**
- `Unauthorized` (20)
- `InvalidAmount` (3)

#### `confirm_payout(remittance_id, proof)`

Confirms payout, optionally validating an off-chain commitment proof.

If `settlement_config.require_proof` is enabled for the remittance, `proof` must be present and match the stored commitment hash.

**Parameters:**
- `remittance_id: u64`
- `proof: Option<BytesN<32>>`

**Additional Errors:**
- `InvalidProof` (50)
- `MissingProof` (51)

#### `get_rate_limit_status(address)`

Public view function to inspect request usage in the active rate-limit window.

**Returns:** `(requests_used, max_requests, window_seconds)`

### Administrative Functions

#### `initialize`

Initialize the contract with admin, USDC token, and platform fee.

**Authorization:** None (can only be called once)

**Parameters:**
- `admin: Address` - Admin address with full control
- `usdc_token: Address` - USDC token contract address
- `fee_bps: u32` - Platform fee in basis points (0-10000)

**Returns:** `Result<(), ContractError>`

**Errors:**
- `AlreadyInitialized` (1) - Contract already initialized
- `InvalidFeeBps` (4) - Fee exceeds 10000 bps (100%)

**Example:**
```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --usdc_token CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --fee_bps 250
```

---

#### `register_agent`

Register an agent to handle remittances.

**Authorization:** Admin only

**Parameters:**
- `agent: Address` - Agent address to register

**Returns:** `Result<(), ContractError>`

**Errors:**
- `NotInitialized` (2) - Contract not initialized

**Events:** `agent_reg(agent)`

**Example:**
```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source admin \
  --network testnet \
  -- \
  register_agent \
  --agent GXXXXXXXXXXXXXXXXXX
---

## WebSocket — Real-time FX Rate Feed

SwiftRemit exposes a Socket.io namespace at `/fx-rates` (mounted under the WebSocket path `/ws`) for real-time FX rate pushes. Clients subscribe to currency pairs and receive updates within 1 s of each cache refresh.

### Connection

```
ws://<host>:<port>/ws/fx-rates
```

Socket.io client path option: `{ path: '/ws' }`

### Events — Client → Server

#### `subscribe`
Subscribe to one or more currency pairs. The server immediately sends the last known rate for each pair (rate-replay).

```json
{ "pairs": ["USD/PHP", "USD/MXN"] }
```

#### `unsubscribe`
Unsubscribe from one or more currency pairs.

```json
{ "pairs": ["USD/MXN"] }
```

### Events — Server → Client

#### `fx_rate`
Emitted whenever the FX cache refreshes a subscribed pair.

```json
{
  "pair": "USD/PHP",
  "from": "USD",
  "to": "PHP",
  "rate": 57.83,
  "timestamp": "2026-06-28T10:00:01.000Z",
  "provider": "ExchangeRateAPI"
}
```

### Reconnect behaviour
Socket.io handles reconnect automatically. On reconnect the client should re-send `subscribe` for all pairs it needs; the server will replay the last known rate immediately.

### Example (JavaScript)

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', { path: '/ws' }).of('/fx-rates');

socket.on('connect', () => {
  socket.emit('subscribe', { pairs: ['USD/PHP', 'USD/MXN'] });
});

socket.on('fx_rate', (update) => {
  console.log(`${update.pair}: ${update.rate} @ ${update.timestamp}`);
});
```

