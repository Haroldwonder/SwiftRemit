import { defineConfig } from "tsup";

export default defineConfig([
  // Node.js: CJS + ESM with full types
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node18",
    outDir: "dist",
    treeshake: true,
  },
  // Testing utilities: exposed to consumers as `@swiftremit/sdk/testing`
  // (see the "./testing" entry in package.json#exports).
  {
    entry: { "testing/index": "src/testing/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    target: "node18",
    outDir: "dist",
    treeshake: true,
  },
  // Browser: minified IIFE (UMD-compatible) with explicit global name
  // Global exposed as `window.SwiftRemitSDK` when loaded via <script> tag / CDN.
  {
    entry: { "browser/index": "src/index.ts" },
    format: ["iife"],
    globalName: "SwiftRemitSDK",
    minify: true,
    dts: false,
    clean: false,
    sourcemap: true,
    target: "es2020",
    outDir: "dist",
    platform: "browser",
    // Bundle everything needed for the browser; only leave out the Stellar SDK
    // because CDN users are expected to load it separately (see CDN_USAGE.md).
    noExternal: [],
    external: ["@stellar/stellar-sdk"],
    treeshake: true,
    esbuildOptions(options) {
      options.conditions = ["browser"];
    },
  },
  // Browser: ESM build for bundlers (Vite, webpack, Rollup).
  // Enables tree-shaking so bundlers can drop unused exports.
  {
    entry: { "browser/index.esm": "src/index.ts" },
    format: ["esm"],
    minify: false,
    dts: false,
    clean: false,
    sourcemap: true,
    target: "es2020",
    outDir: "dist",
    platform: "browser",
    noExternal: [],
    external: ["@stellar/stellar-sdk"],
    treeshake: true,
    esbuildOptions(options) {
      options.conditions = ["browser"];
      options.define = {
        ...options.define,
        global: "globalThis",
      };
    },
  },
]);
