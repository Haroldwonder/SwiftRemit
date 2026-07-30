/**
 * Stellar anchor TOML validator — API-local copy.
 *
 * The canonical implementation lives in backend/src/anchor-toml-validator.ts.
 * This copy exists so the api/ package can call it without a cross-package
 * import (SR-060).  Keep the two files in sync when logic changes.
 */

import axios from 'axios';
import NodeCache from 'node-cache';
import toml from 'toml';

// Cache TOML data for 24 hours to avoid hammering remote domains.
const tomlCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

export interface TomlData {
  SIGNING_KEY?: string;
  NETWORK_PASSPHRASE?: string;
  [key: string]: unknown;
}

/**
 * Fetch and parse stellar.toml for a given home domain.
 * Results are cached for 24 h; throws on network failure or missing fields.
 */
export async function fetchAnchorToml(homeDomain: string): Promise<TomlData> {
  const cacheKey = `toml:${homeDomain}`;
  const cached = tomlCache.get<TomlData>(cacheKey);
  if (cached) return cached;

  const url = `https://${homeDomain}/.well-known/stellar.toml`;
  const response = await axios.get<string>(url, {
    timeout: 10_000,
    responseType: 'text',
    headers: { Accept: 'text/plain' },
  });

  const data: TomlData = toml.parse(response.data);

  const missingFields: string[] = [];
  if (!data.SIGNING_KEY) missingFields.push('SIGNING_KEY');
  if (!data.NETWORK_PASSPHRASE) missingFields.push('NETWORK_PASSPHRASE');
  if (missingFields.length > 0) {
    throw new Error(`stellar.toml missing required fields: ${missingFields.join(', ')}`);
  }

  tomlCache.set(cacheKey, data);
  return data;
}

/**
 * Invalidate cached TOML for a domain (forces re-fetch on next request).
 */
export function invalidateTomlCache(homeDomain: string): void {
  tomlCache.del(`toml:${homeDomain}`);
}

/**
 * Validate that the anchor's declared SIGNING_KEY in stellar.toml matches
 * the public_key stored in our DB.  Returns true if valid, false otherwise.
 */
export async function validateAnchorToml(
  homeDomain: string,
  expectedKey: string,
): Promise<boolean> {
  try {
    const data = await fetchAnchorToml(homeDomain);
    if (!data.SIGNING_KEY) return false;
    return data.SIGNING_KEY === expectedKey;
  } catch {
    return false;
  }
}
