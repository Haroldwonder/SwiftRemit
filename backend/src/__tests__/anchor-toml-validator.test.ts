import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios and toml before importing the module under test
vi.mock('axios');
vi.mock('toml');
vi.mock('node-cache', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      del: vi.fn(),
    })),
  };
});

import axios from 'axios';
import toml from 'toml';
import { validateAnchorToml, invalidateTomlCache } from '../anchor-toml-validator';

const DOMAIN = 'anchor.example.com';
const SIGNING_KEY = 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37';

describe('validateAnchorToml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTomlCache(DOMAIN);
  });

  it('returns true when SIGNING_KEY matches', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: `SIGNING_KEY = "${SIGNING_KEY}"` });
    vi.mocked(toml.parse).mockReturnValue({ SIGNING_KEY });

    const result = await validateAnchorToml(DOMAIN, SIGNING_KEY);
    expect(result).toBe(true);
  });

  it('returns false when SIGNING_KEY does not match (spoofed anchor)', async () => {
    const spoofedKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    vi.mocked(axios.get).mockResolvedValue({ data: `SIGNING_KEY = "${spoofedKey}"` });
    vi.mocked(toml.parse).mockReturnValue({ SIGNING_KEY: spoofedKey });

    const result = await validateAnchorToml(DOMAIN, SIGNING_KEY);
    expect(result).toBe(false);
  });

  it('returns false when SIGNING_KEY is absent from TOML', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: '' });
    vi.mocked(toml.parse).mockReturnValue({});

    const result = await validateAnchorToml(DOMAIN, SIGNING_KEY);
    expect(result).toBe(false);
  });

  it('returns false when fetch fails', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

    const result = await validateAnchorToml(DOMAIN, SIGNING_KEY);
    expect(result).toBe(false);
  });
});
