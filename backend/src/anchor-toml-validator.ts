import axios from 'axios';
import NodeCache from 'node-cache';
import toml from 'toml';
import { createLogger } from './correlation-id';

const logger = createLogger('AnchorTomlValidator');

// Cache TOML data for 24 hours
const tomlCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

export interface TomlData {
  SIGNING_KEY?: string;
  NETWORK_PASSPHRASE?: string;
  [key: string]: unknown;
}

/**
 * Fetch and parse stellar.toml for a given home domain.
 * Results are cached for 24 h and re-validated on cache miss.
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
  tomlCache.set(cacheKey, data);
  logger.debug('Fetched and cached stellar.toml', { homeDomain });
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
 *
 * @param homeDomain  The anchor's home domain (e.g. "anchor.example.com")
 * @param expectedKey The public_key stored in the anchors table
 */
export async function validateAnchorToml(
  homeDomain: string,
  expectedKey: string
): Promise<boolean> {
  try {
    const data = await fetchAnchorToml(homeDomain);
    if (!data.SIGNING_KEY) {
      logger.warn('stellar.toml missing SIGNING_KEY', { homeDomain });
      return false;
    }
    const valid = data.SIGNING_KEY === expectedKey;
    if (!valid) {
      logger.warn('SIGNING_KEY mismatch', {
        homeDomain,
        tomlKey: data.SIGNING_KEY,
        expectedKey,
      });
    }
    return valid;
  } catch (err) {
    logger.error('Failed to fetch/validate stellar.toml', { homeDomain, err });
    return false;
  }
}
