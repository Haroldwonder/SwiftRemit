import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { initializeCurrencyConfig } from '../config';
import { getConversionRateService } from '../services/conversionRates';

/** #1876: same-currency rates bypass the conversion service after alias resolution. */
describe('same-currency conversion rates', () => {
  beforeAll(() => {
    process.env.CURRENCY_CONFIG_PATH = './config/currencies.json';
    initializeCurrencyConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['USD', 'USD'],
    ['usd', 'Usd'],
    ['DOLLAR', 'USD'],
    ['USD', 'DOLLARS'],
  ])('returns identity for %s -> %s without contacting the rate service', async (from, to) => {
    const getRate = vi.spyOn(getConversionRateService(), 'getRate');
    const response = await request(createApp()).get(`/api/currencies/${from}/rates/${to}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      from: 'USD',
      to: 'USD',
      rate: 1,
      provider: 'identity',
    });
    expect(Number.isNaN(Date.parse(response.body.data.fetched_at))).toBe(false);
    expect(getRate).not.toHaveBeenCalled();
  });

  it('serves a URL-encoded multiword alias even when the rate provider is offline', async () => {
    // Express decodes the path parameter; the two aliases resolve to USD.
    const getRate = vi.spyOn(getConversionRateService(), 'getRate').mockRejectedValue(
      new Error('rate provider offline'),
    );
    const response = await request(createApp()).get('/api/currencies/US%20DOLLARS/rates/DOLLAR');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      from: 'USD',
      to: 'USD',
      rate: 1,
      provider: 'identity',
    });
    expect(getRate).not.toHaveBeenCalled();
  });

  it('still uses the conversion service for different currencies', async () => {
    const rate = { from: 'USD', to: 'EUR', rate: 0.92, fetched_at: new Date().toISOString() };
    const getRate = vi.spyOn(getConversionRateService(), 'getRate').mockResolvedValue(rate);
    const response = await request(createApp()).get('/api/currencies/USD/rates/EUR');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(rate);
    expect(getRate).toHaveBeenCalledTimes(1);
    expect(getRate).toHaveBeenCalledWith('USD', 'EUR');
  });

  it('returns 404 for unknown currencies without calling the rate service', async () => {
    const getRate = vi.spyOn(getConversionRateService(), 'getRate');
    const response = await request(createApp()).get('/api/currencies/NOTFOUND/rates/NOTFOUND');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CURRENCY_NOT_FOUND');
    expect(getRate).not.toHaveBeenCalled();
  });
});
