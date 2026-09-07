import { describe, it, expect } from 'vitest';
import { cacheKey, BLOCK_RANGE, InMemoryScoreCache } from './cache';
import type { Score } from '../types/index';

function fakeScore(value = 72): Score {
  return {
    address: '0xabc', chain: 'ethereum', value,
    subscores: { accountMaturity: 0, portfolioQuality: 0, leverageHistory: 0, counterpartyHygiene: 0, recentVolatility: 0 },
    weights: { accountMaturity: 0.15, portfolioQuality: 0.25, leverageHistory: 0.3, counterpartyHygiene: 0.2, recentVolatility: 0.1 },
    asOfBlock: 1000, computedAt: '2026-09-06T00:00:00.000Z', inputs: [], modelVersion: '1.0.0',
  };
}

describe('cacheKey', () => {
  it('lowercases the address and buckets by block range', () => {
    expect(cacheKey('0xAbC', 1000)).toBe(`0xabc:${Math.floor(1000 / BLOCK_RANGE)}`);
  });
  it('puts blocks in the same window in the same bucket, different windows apart', () => {
    expect(cacheKey('0x1', 100)).toBe(cacheKey('0x1', 299));
    expect(cacheKey('0x1', 100)).not.toBe(cacheKey('0x1', 400));
  });
});

describe('InMemoryScoreCache', () => {
  it('stores and returns a score', () => {
    const c = new InMemoryScoreCache();
    c.set('k', fakeScore());
    expect(c.get('k')?.value).toBe(72);
  });

  it('misses on an unknown key', () => {
    expect(new InMemoryScoreCache().get('nope')).toBeUndefined();
  });

  it('expires entries after the TTL', () => {
    let t = 0;
    const c = new InMemoryScoreCache(1000, () => t);
    c.set('k', fakeScore());
    t = 999;
    expect(c.get('k')).toBeDefined();
    t = 1000;
    expect(c.get('k')).toBeUndefined(); // expired
  });
});
