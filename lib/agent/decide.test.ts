import { describe, it, expect } from 'vitest';
import { shouldSpend, allowedStaleness, needsEscalation, suggestedLimit, STALENESS_BASE_BLOCKS } from './decide';

const PRICE = 0.002;

describe('allowedStaleness', () => {
  it('decreases as exposure grows', () => {
    expect(allowedStaleness(100)).toBeGreaterThan(allowedStaleness(1000));
    expect(allowedStaleness(1000)).toBeGreaterThan(allowedStaleness(50000));
  });
  it('is clamped to sane bounds', () => {
    expect(allowedStaleness(1)).toBeLessThanOrEqual(STALENESS_BASE_BLOCKS * 4);
    expect(allowedStaleness(10_000_000)).toBeGreaterThanOrEqual(10);
  });
});

describe('shouldSpend', () => {
  const base = { currentBlock: 1000, exposureUnits: 1000, budgetRemainingUsd: 5, priceUsd: PRICE };

  it('skips when the daily budget cannot cover another query', () => {
    expect(shouldSpend({ ...base, cachedScore: null, budgetRemainingUsd: 0 })).toEqual({ spend: false, reason: 'budget_exhausted' });
  });

  it('buys when there is no score yet', () => {
    expect(shouldSpend({ ...base, cachedScore: null })).toEqual({ spend: true, reason: 'no_score' });
  });

  it('skips a fresh score for a low-exposure holder', () => {
    // score computed 50 blocks ago, exposure 50 units -> well within allowed staleness
    const d = shouldSpend({ ...base, exposureUnits: 50, cachedScore: { asOfBlock: 950 } });
    expect(d).toEqual({ spend: false, reason: 'fresh' });
  });

  it('buys a stale score', () => {
    const d = shouldSpend({ ...base, exposureUnits: 1000, cachedScore: { asOfBlock: 0 } });
    expect(d).toEqual({ spend: true, reason: 'stale' });
  });

  it('treats the SAME staleness as fresh for low exposure but stale for high exposure', () => {
    const cachedScore = { asOfBlock: 900 }; // 100 blocks old
    const low = shouldSpend({ ...base, exposureUnits: 50, cachedScore });
    const high = shouldSpend({ ...base, exposureUnits: 50_000, cachedScore });
    expect(low.spend).toBe(false); // fresh enough for a tiny holder
    expect(high.spend).toBe(true); // worth re-checking a whale immediately
  });
});

describe('needsEscalation', () => {
  const policy = { quorumThresholdUnits: 10_000 };
  it('escalates any revocation', () => {
    expect(needsEscalation({ limit: 0, revokes: true }, policy)).toBe(true);
  });
  it('escalates issuance above the threshold', () => {
    expect(needsEscalation({ limit: 50_000, revokes: false }, policy)).toBe(true);
  });
  it('lets an under-threshold issuance through autonomously', () => {
    expect(needsEscalation({ limit: 5_000, revokes: false }, policy)).toBe(false);
  });
});

describe('suggestedLimit', () => {
  it('denies below the floor', () => {
    expect(suggestedLimit(39, 100_000)).toBe(0);
  });
  it('scales with the score up to the max', () => {
    expect(suggestedLimit(40, 100_000)).toBe(0);
    expect(suggestedLimit(100, 100_000)).toBe(100_000);
    expect(suggestedLimit(70, 100_000)).toBe(50_000); // halfway from 40..100
  });
});
