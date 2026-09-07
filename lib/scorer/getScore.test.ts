import { describe, it, expect, vi } from 'vitest';
import { getScore, type ScoreDeps } from './getScore';
import { InMemoryScoreCache } from './cache';
import type { RawLendingData, RawPortfolio } from './sources';

const cleanLending: RawLendingData = {
  firstActivityBlock: 100, currentBlock: 2_628_100, activeDays: 120, txCount: 60,
  openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0,
};
const portfolio: RawPortfolio = [
  { symbol: 'USDC', valueUsd: 5000, isStablecoin: true },
  { symbol: 'WETH', valueUsd: 5000, isStablecoin: false },
];

function deps(overrides: Partial<ScoreDeps> = {}): ScoreDeps {
  return {
    fetchLending: vi.fn(async () => cleanLending),
    fetchPortfolio: vi.fn(async () => portfolio),
    cache: new InMemoryScoreCache(),
    ...overrides,
  };
}

const OPTS = { atBlock: 2_628_100, chain: 'ethereum' };

describe('getScore', () => {
  it('fetches, computes, and caches on a cache miss', async () => {
    const d = deps();
    const score = await getScore('0xabc', OPTS, d);
    expect(score.address).toBe('0xabc');
    expect(score.value).toBeGreaterThan(0);
    expect(score.inputs).toContain('messari-lending');
    expect(d.fetchLending).toHaveBeenCalledOnce();
    expect(d.fetchPortfolio).toHaveBeenCalledOnce();
  });

  it('serves a cache hit without touching the network (the query-budget guarantee)', async () => {
    const d = deps();
    await getScore('0xabc', OPTS, d); // populate
    await getScore('0xabc', OPTS, d); // second call, same block bucket
    expect(d.fetchLending).toHaveBeenCalledOnce();
    expect(d.fetchPortfolio).toHaveBeenCalledOnce();
  });

  it('still returns a valid score for an empty portfolio', async () => {
    const d = deps({ fetchPortfolio: vi.fn(async () => []) });
    const score = await getScore('0xabc', OPTS, d);
    expect(score.subscores.portfolioQuality).toBe(0);
    expect(score.value).toBeGreaterThanOrEqual(0);
  });

  it('scores a liquidated, over-levered subject below a clean one (beat 5)', async () => {
    const clean = await getScore('0xclean', OPTS, deps());

    const distressedLending: RawLendingData = { ...cleanLending, openBorrowsUsd: 9500, collateralUsd: 10000, minHealthFactor: 1.05, liquidationCount: 2 };
    const risky = await getScore('0xrisky', OPTS, deps({ fetchLending: vi.fn(async () => distressedLending) }));

    expect(risky.value).toBeLessThan(clean.value);
  });
});
