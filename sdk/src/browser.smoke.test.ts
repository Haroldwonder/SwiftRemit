/**
 * Browser smoke test — sdk/src/browser.smoke.test.ts
 *
 * Verifies that:
 *  1. The SDK can be imported in a browser-like environment (jsdom / happy-dom).
 *  2. Key exports are present and have the correct types.
 *  3. Amount-conversion helpers (toStroops / fromStroops) work correctly.
 *  4. Input validation helpers throw on bad input (integration with #1160).
 *  5. SwiftRemitClient can be instantiated without throwing.
 *
 * NOTE: This test does NOT make real RPC calls — it verifies the public surface
 * of the bundle that would be loaded via a CDN <script> tag.  A real end-to-end
 * read-only call against testnet is covered by the testnet integration workflow.
 */

import { describe, it, expect } from "vitest";

// Import from the package root so we exercise the same code path that a CDN
// script-tag consumer would get (the IIFE build re-exports all of index.ts).
import {
  SwiftRemitClient,
  Networks,
  RpcUrls,
  USDC_MULTIPLIER,
  toStroops,
  fromStroops,
  validateAmount,
  validateAddress,
  estimateStellarFee,
  SwiftRemitError,
  ErrorCode,
} from "./index.js";

// ─── 1. Export presence ───────────────────────────────────────────────────────

describe("browser bundle exports", () => {
  it("exports SwiftRemitClient as a class", () => {
    expect(typeof SwiftRemitClient).toBe("function");
    expect(SwiftRemitClient.prototype).toBeDefined();
  });

  it("exports Networks with TESTNET and MAINNET passphrases", () => {
    expect(typeof Networks.TESTNET).toBe("string");
    expect(typeof Networks.MAINNET).toBe("string");
    expect(Networks.TESTNET).toContain("Test SDF");
    expect(Networks.MAINNET).toContain("Public Global");
  });

  it("exports RpcUrls with TESTNET and MAINNET endpoints", () => {
    expect(RpcUrls.TESTNET).toMatch(/^https?:\/\//);
    expect(RpcUrls.MAINNET).toMatch(/^https?:\/\//);
  });

  it("exports USDC_MULTIPLIER as a bigint", () => {
    expect(typeof USDC_MULTIPLIER).toBe("bigint");
    expect(USDC_MULTIPLIER).toBe(10_000_000n);
  });

  it("exports validation helpers", () => {
    expect(typeof validateAmount).toBe("function");
    expect(typeof validateAddress).toBe("function");
  });

  it("exports estimateStellarFee as a function", () => {
    expect(typeof estimateStellarFee).toBe("function");
  });
});

// ─── 2. Amount conversion ─────────────────────────────────────────────────────

describe("toStroops / fromStroops", () => {
  it("converts whole USDC amounts correctly", () => {
    expect(toStroops(1)).toBe(10_000_000n);
    expect(toStroops(100)).toBe(1_000_000_000n);
    expect(toStroops(0)).toBe(0n);
  });

  it("round-trips via fromStroops", () => {
    const usdc = 42.5;
    expect(fromStroops(toStroops(usdc))).toBeCloseTo(usdc, 7);
  });

  it("fromStroops returns a number", () => {
    expect(typeof fromStroops(10_000_000n)).toBe("number");
    expect(fromStroops(10_000_000n)).toBe(1);
  });
});

// ─── 3. Input validation (#1160 integration) ──────────────────────────────────

describe("validateAmount", () => {
  it("accepts valid positive integer amounts (as bigint)", () => {
    expect(() => validateAmount(10_000_000n)).not.toThrow();
    expect(() => validateAmount(1n)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => validateAmount(0n)).toThrow(SwiftRemitError);
    expect(() => validateAmount(0n)).toThrow(/greater than zero/i);
  });

  it("rejects negative amounts", () => {
    expect(() => validateAmount(-1n)).toThrow(SwiftRemitError);
    expect(() => validateAmount(-10_000_000n)).toThrow(SwiftRemitError);
  });

  it("rejects non-bigint input (e.g. a float passed as number)", () => {
    // @ts-expect-error intentional wrong type for runtime test
    expect(() => validateAmount(1.5)).toThrow(SwiftRemitError);
    // @ts-expect-error intentional wrong type for runtime test
    expect(() => validateAmount("100")).toThrow(SwiftRemitError);
  });
});

describe("validateAddress", () => {
  const VALID_STELLAR_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  it("accepts a valid Stellar address", () => {
    expect(() => validateAddress(VALID_STELLAR_ADDRESS)).not.toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => validateAddress("")).toThrow(SwiftRemitError);
  });

  it("rejects a non-G... Stellar address", () => {
    expect(() => validateAddress("XAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4")).toThrow(SwiftRemitError);
  });

  it("rejects a too-short string", () => {
    expect(() => validateAddress("GABC")).toThrow(SwiftRemitError);
  });

  it("rejects a string with invalid characters", () => {
    expect(() => validateAddress("G" + "0".repeat(55))).toThrow(SwiftRemitError);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error intentional wrong type for runtime test
    expect(() => validateAddress(null)).toThrow(SwiftRemitError);
    // @ts-expect-error intentional wrong type for runtime test
    expect(() => validateAddress(12345)).toThrow(SwiftRemitError);
  });
});

// ─── 4. SwiftRemitClient instantiation ───────────────────────────────────────

describe("SwiftRemitClient instantiation", () => {
  it("constructs without throwing for a valid config", () => {
    expect(
      () =>
        new SwiftRemitClient({
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
          networkPassphrase: Networks.TESTNET,
          rpcUrl: RpcUrls.TESTNET,
        })
    ).not.toThrow();
  });

  it("exposes expected read methods", () => {
    const client = new SwiftRemitClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      networkPassphrase: Networks.TESTNET,
      rpcUrl: RpcUrls.TESTNET,
    });
    expect(typeof client.health).toBe("function");
    expect(typeof client.getRemittance).toBe("function");
    expect(typeof client.getAccumulatedFees).toBe("function");
    expect(typeof client.isAgentRegistered).toBe("function");
  });
});

// ─── 5. estimateStellarFee ────────────────────────────────────────────────────

describe("estimateStellarFee", () => {
  it("returns the base fee for 1 operation", () => {
    expect(estimateStellarFee(1, 100)).toBeCloseTo(0.00001, 10);
  });

  it("scales linearly with operation count", () => {
    expect(estimateStellarFee(10, 100)).toBeCloseTo(0.0001, 10);
  });

  it("throws for operationCount < 1", () => {
    expect(() => estimateStellarFee(0)).toThrow(RangeError);
  });
});

// ─── 6. ErrorCode enum completeness ──────────────────────────────────────────

describe("ErrorCode enum", () => {
  it("contains InvalidAmount", () => {
    expect(ErrorCode.InvalidAmount).toBeDefined();
  });

  it("contains InvalidAddress", () => {
    expect(ErrorCode.InvalidAddress).toBeDefined();
  });
});
