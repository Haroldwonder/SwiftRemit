# SwiftRemit SDK — Browser / CDN Usage

This guide covers loading the SwiftRemit SDK directly in a browser without a build tool
(via CDN), the polyfills it requires, and how to keep bundle size under control when using
a bundler.

---

## Quick-start: Script tag / CDN

The IIFE build exposes a single global: **`window.SwiftRemitSDK`**.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SwiftRemit CDN example</title>
</head>
<body>
  <!--
    1. Polyfills — load before the SDK.
       The Stellar SDK relies on the Node.js `Buffer` global.
       The easiest drop-in for browsers is the `buffer` package via esm.sh.
  -->
  <script type="module">
    import { Buffer } from "https://esm.sh/buffer@6";
    window.Buffer = Buffer;   // make it available globally
  </script>

  <!-- 2. Stellar SDK (peer dependency — must be loaded before SwiftRemitSDK) -->
  <script src="https://unpkg.com/@stellar/stellar-sdk@13/dist/stellar-sdk.min.js"></script>

  <!-- 3. SwiftRemit SDK -->
  <script src="https://unpkg.com/@swiftremit/sdk@latest/dist/browser/index.global.js"></script>

  <!-- 4. Your application code -->
  <script>
    const { SwiftRemitClient, Networks, RpcUrls, toStroops, fromStroops } = SwiftRemitSDK;

    async function main() {
      const client = new SwiftRemitClient({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        networkPassphrase: Networks.TESTNET,
        rpcUrl: RpcUrls.TESTNET,
      });

      // Read-only: fetch the on-chain health status
      const healthQueryAddress = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
      const health = await client.health(healthQueryAddress);
      console.log("Contract healthy:", !health.paused);
      console.log("Total remittances:", health.totalRemittances.toString());

      // Amount conversion helpers
      console.log("100 USDC in stroops:", toStroops(100).toString()); // 1000000000n
      console.log("1000000000 stroops in USDC:", fromStroops(1_000_000_000n)); // 100
    }

    main().catch(console.error);
  </script>
</body>
</html>
```

---

## Required polyfills

| Polyfill | Why it is needed | CDN / npm |
|---|---|---|
| `Buffer` | The Stellar SDK uses Node's `Buffer` for XDR (de)serialisation. Browsers do not have it natively. | `https://esm.sh/buffer@6` or `npm i buffer` |
| `TextEncoder` / `TextDecoder` | Used internally by the Stellar SDK for UTF-8 conversion. Built-in in all modern browsers (Chrome 38+, Firefox 19+, Safari 10.1+). Polyfill only needed for IE11 / legacy WebKit. | `https://cdn.jsdelivr.net/npm/text-encoding@0.7.0/lib/encoding.min.js` |
| `fetch` | Used for Soroban RPC calls. Built-in in all modern browsers. Polyfill only needed for IE11 / very old mobile browsers. | `https://cdn.jsdelivr.net/npm/whatwg-fetch@3.6.20/fetch.min.js` |

> **Crypto**: The SDK does not perform key-signing in the browser bundle — it only builds
> and prepares transactions. Signing should be delegated to a wallet (e.g. Freighter,
> Albedo, WalletConnect) which supplies the `Keypair` externally. If you do sign in-browser,
> the Stellar SDK uses the Web Crypto API (`window.crypto.subtle`), which is available
> natively in all modern browsers and requires HTTPS.

---

## ESM bundlers (Vite, webpack, Rollup, esbuild)

Prefer the `"browser"` export condition — bundlers will pick it up automatically from
`package.json`:

```ts
// Tree-shakeable: only the symbols you import are included in your final bundle.
import { SwiftRemitClient, toStroops, Networks, RpcUrls } from "@swiftremit/sdk";
```

Add the Buffer polyfill in your bundler config if your target environment does not provide
it:

**Vite (`vite.config.ts`)**
```ts
import { defineConfig } from "vite";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";

export default defineConfig({
  optimizeDeps: {
    esbuildOptions: {
      plugins: [NodeGlobalsPolyfillPlugin({ buffer: true })],
    },
  },
  resolve: {
    alias: { buffer: "buffer" },
  },
});
```

**webpack 5 (`webpack.config.js`)**
```js
const { ProvidePlugin } = require("webpack");

module.exports = {
  resolve: {
    fallback: { buffer: require.resolve("buffer/") },
  },
  plugins: [
    new ProvidePlugin({ Buffer: ["buffer", "Buffer"] }),
  ],
};
```

---

## Bundle size budget

The CI pipeline enforces the following gzipped size budgets (see `"size-limit"` in
`package.json`):

| Artifact | Budget (gzipped) |
|---|---|
| `dist/browser/index.global.js` (IIFE) | 120 kB |
| `dist/browser/index.esm.mjs` (ESM, bundlers) | 120 kB |
| `dist/index.js` (Node CJS) | 150 kB |

Run locally after building:

```bash
npm run build
npm run size
```

CI fails automatically if any budget is exceeded (the `size:ci` script is called in the
`sdk-ci` workflow).

---

## Tree-shaking verification

The ESM browser build (`dist/browser/index.esm.mjs`) is produced with `treeshake: true`
in tsup. To verify that your bundler successfully tree-shakes unused exports:

```bash
# Install bundle analyser (example using vite-bundle-visualizer)
npm i -D vite-bundle-visualizer
npx vite-bundle-visualizer
```

A correct tree-shaken build importing only `{ SwiftRemitClient }` should be
significantly smaller than the full bundle.

---

## React Native

For React Native consumers, use the dedicated subpackage:

```ts
import { SwiftRemitClient } from "@swiftremit/sdk/react-native";
```

See [`sdk/react-native/README.md`](sdk/react-native/README.md) for setup instructions.
