# SwiftRemit Frontend

React + TypeScript frontend for the SwiftRemit USDC remittance platform, built with Vite and the Stellar SDK.

See also: [Root README](../README.md) | [Deployment Guide](../DEPLOYMENT.md)

---

## Prerequisites

Before running the frontend, ensure you have:

- **Node.js >= 18** (check with `node --version`)
- **npm** or **yarn** package manager
- **[Freighter wallet extension](https://www.freighter.app/)** installed in your browser (Chrome, Firefox, or Brave)
- A **deployed SwiftRemit contract** on Stellar testnet (see [DEPLOYMENT.md](../DEPLOYMENT.md))
- **Testnet XLM** for transaction fees (get from [Stellar Friendbot](https://friendbot.stellar.org))
- **Testnet USDC** for testing remittances (available via testnet faucets)

---

## Environment Setup

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# Stellar Network
VITE_NETWORK=testnet
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Your deployed contract address (C...)
VITE_CONTRACT_ID=

# Testnet USDC token contract address
VITE_USDC_TOKEN_ID=
```

### Environment Variables Explained

| Variable | Description | Example |
| -------- | ----------- | ------- |
| `VITE_NETWORK` | Stellar network to connect to | `testnet` or `mainnet` |
| `VITE_HORIZON_URL` | Horizon API endpoint for Stellar operations | `https://horizon-testnet.stellar.org` |
| `VITE_SOROBAN_RPC_URL` | Soroban RPC endpoint for smart contract calls | `https://soroban-testnet.stellar.org` |
| `VITE_CONTRACT_ID` | Your deployed SwiftRemit contract address (starts with `C`) | `CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` |
| `VITE_USDC_TOKEN_ID` | Testnet USDC token contract address | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

**Important Notes:**

- All `VITE_` prefixed variables are bundled into the client at **build time** by Vite
- Changes to `.env` require restarting the dev server to take effect
- Never commit `.env` to version control (it's in `.gitignore`)
- For mainnet deployment, update all URLs and addresses accordingly

---

## Running Locally

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev
```

---

## Building for Production

```bash
npm run build
# Output goes to dist/
```

To preview the production build locally:

```bash
npm run preview
```

---

## Pointing the App at a Deployed Contract

1. Deploy the SwiftRemit contract to testnet following [DEPLOYMENT.md](../DEPLOYMENT.md).
2. Copy the resulting contract ID (starts with `C`).
3. Set `VITE_CONTRACT_ID=<your-contract-id>` in your `.env`.
4. Restart the dev server (`npm run dev`) — Vite picks up env changes on restart.

The app reads `import.meta.env.VITE_CONTRACT_ID` at runtime to initialize the Soroban RPC client and sign transactions via Freighter.

---

## Connecting Your Wallet

1. Install the [Freighter extension](https://www.freighter.app/).
2. Switch Freighter to **Testnet** (Settings → Network → Testnet).
3. Fund your testnet account via [Stellar Friendbot](https://friendbot.stellar.org/?addr=<your-address>).
4. Click "Connect Wallet" in the app — Freighter will prompt for approval.
