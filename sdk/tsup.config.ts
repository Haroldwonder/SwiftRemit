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
  },
  // Browser: IIFE (UMD-compatible) + ESM, suitable for CDN use
  {
    entry: { "browser/index": "src/index.ts" },
    format: ["iife", "esm"],
    globalName: "SwiftRemitSDK",
    dts: false,
    clean: false,
    sourcemap: true,
    target: "es2020",
    outDir: "dist",
    platform: "browser",
    minify: false,
    splitting: false,
    // Prevent Node.js built-ins from leaking into the browser bundle
    noExternal: [],
    external: ["@stellar/stellar-sdk"],
    esbuildOptions(options) {
      options.conditions = ["browser"];
      options.define = {
        ...options.define,
        global: "globalThis",
      };
    },
  },
]);
