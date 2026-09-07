import { describe, it, expect } from 'vitest';
import {
  clamp,
  WEIGHTS,
  MODEL_VERSION,
  BLOCKS_PER_YEAR,
  normalizeAccountMaturity,
  normalizePortfolioQuality,
  normalizeLeverageHistory,
  normalizeCounterpartyHygiene,
  normalizeRecentVolatility,
  computeSubscores,
  computeScore,
} from './model';
import { ScoreSchema, type ScoreInputs } from '../types/index';

/** A healthy, fully-mature baseline. Each test mutates one facet of it. */
function baseInputs(): ScoreInputs {
  return {
    accountMaturity: { firstSeenBlock: 0, currentBlock: BLOCKS_PER_YEAR, activeDays: 180, txCount: 500 },
    portfolio: { totalUsd: 100_000, stablecoinUsd: 50_000, largestPositionUsd: 25_000, positionCount: 6 },
    leverage: { openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 },
    counterparty: { flaggedInteractionCount: 0, totalCounterparties: 20 },
    volatility: { balanceStdDevPct: 0 },
  };
}

const META = { address: '0xabc', chain: 'ethereum', asOfBlock: 123, inputs: ['messari-lending', 'token-api'], computedAt: '2026-09-06T00:00:00.000Z' };

describe('clamp', () => {
  it('clamps below, above, and passes through in-range', () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(42)).toBe(42);
  });
  it('returns the low bound for NaN', () => {
    expect(clamp(NaN)).toBe(0);
    expect(clamp(NaN, 10, 100)).toBe(10);
  });
});

describe('weights', () => {
  it('sum to exactly 1.0', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe('normalizeAccountMaturity', () => {
  it('is 0 for a brand-new, inactive wallet', () => {
    expect(normalizeAccountMaturity({ firstSeenBlock: 500, currentBlock: 500, activeDays: 0, txCount: 0 })).toBe(0);
  });
  it('is 100 for a >=1yr, active, high-tx wallet', () => {
    expect(normalizeAccountMaturity({ firstSeenBlock: 0, currentBlock: BLOCKS_PER_YEAR, activeDays: 180, txCount: 500 })).toBe(100);
  });
  it('saturates at 100 beyond the thresholds', () => {
    expect(normalizeAccountMaturity({ firstSeenBlock: 0, currentBlock: BLOCKS_PER_YEAR * 5, activeDays: 9999, txCount: 99999 })).toBe(100);
  });
});

describe('normalizePortfolioQuality', () => {
  it('is 0 for an empty portfolio', () => {
    expect(normalizePortfolioQuality({ totalUsd: 0, stablecoinUsd: 0, largestPositionUsd: 0, positionCount: 0 })).toBe(0);
  });
  it('rewards a diversified, stablecoin-heavy book over a concentrated one', () => {
    const diversified = normalizePortfolioQuality({ totalUsd: 100_000, stablecoinUsd: 80_000, largestPositionUsd: 20_000, positionCount: 10 });
    const concentrated = normalizePortfolioQuality({ totalUsd: 100_000, stablecoinUsd: 0, largestPositionUsd: 100_000, positionCount: 1 });
    expect(diversified).toBeGreaterThan(concentrated);
  });
});

describe('normalizeLeverageHistory', () => {
  it('scores a never-borrowed wallet well (but not perfect)', () => {
    // liqScore 100*0.5 + neverBorrowed 80*0.3 + utilScore 100*0.2 = 50 + 24 + 20 = 94
    expect(normalizeLeverageHistory({ openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 })).toBe(94);
  });
  it('drops sharply with each liquidation', () => {
    const clean = normalizeLeverageHistory({ openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 });
    const oneLiq = normalizeLeverageHistory({ openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 1 });
    const threeLiq = normalizeLeverageHistory({ openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 3 });
    expect(oneLiq).toBeLessThan(clean);
    expect(threeLiq).toBeLessThan(oneLiq);
  });
  it('penalizes a low health factor', () => {
    const safe = normalizeLeverageHistory({ openBorrowsUsd: 50, collateralUsd: 100, minHealthFactor: 2, liquidationCount: 0 });
    const risky = normalizeLeverageHistory({ openBorrowsUsd: 90, collateralUsd: 100, minHealthFactor: 1.05, liquidationCount: 0 });
    expect(risky).toBeLessThan(safe);
  });
});

describe('normalizeCounterpartyHygiene', () => {
  it('is 100 with no flagged interactions', () => {
    expect(normalizeCounterpartyHygiene({ flaggedInteractionCount: 0, totalCounterparties: 50 })).toBe(100);
  });
  it('drops 25 points per flagged counterparty and floors at 0', () => {
    expect(normalizeCounterpartyHygiene({ flaggedInteractionCount: 1, totalCounterparties: 50 })).toBe(75);
    expect(normalizeCounterpartyHygiene({ flaggedInteractionCount: 4, totalCounterparties: 50 })).toBe(0);
    expect(normalizeCounterpartyHygiene({ flaggedInteractionCount: 10, totalCounterparties: 50 })).toBe(0);
  });
});

describe('normalizeRecentVolatility', () => {
  it('is 100 for a perfectly stable balance and 0 for extreme swings', () => {
    expect(normalizeRecentVolatility({ balanceStdDevPct: 0 })).toBe(100);
    expect(normalizeRecentVolatility({ balanceStdDevPct: 50 })).toBe(50);
    expect(normalizeRecentVolatility({ balanceStdDevPct: 120 })).toBe(0);
  });
});

describe('computeScore', () => {
  it('produces a schema-valid Score', () => {
    const score = computeScore(baseInputs(), META);
    expect(() => ScoreSchema.parse(score)).not.toThrow();
  });
  it('stamps the model version and passes through meta', () => {
    const score = computeScore(baseInputs(), META);
    expect(score.modelVersion).toBe(MODEL_VERSION);
    expect(score.asOfBlock).toBe(123);
    expect(score.address).toBe('0xabc');
    expect(score.computedAt).toBe('2026-09-06T00:00:00.000Z');
    expect(score.inputs).toEqual(['messari-lending', 'token-api']);
  });
  it('keeps the value in 0..100', () => {
    const score = computeScore(baseInputs(), META);
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
  });
  it('is deterministic — same inputs, same value', () => {
    const a = computeScore(baseInputs(), META);
    const b = computeScore(baseInputs(), META);
    expect(a.value).toBe(b.value);
    expect(a.subscores).toEqual(b.subscores);
  });

  // This is the demo's whole premise (beat 5): a liquidation drops the score.
  it('scores a liquidated, over-levered wallet below a clean one', () => {
    const clean = computeScore(baseInputs(), META);

    const distressed = baseInputs();
    distressed.leverage = { openBorrowsUsd: 95, collateralUsd: 100, minHealthFactor: 1.02, liquidationCount: 2 };
    distressed.volatility = { balanceStdDevPct: 60 };
    const risky = computeScore(distressed, META);

    expect(risky.value).toBeLessThan(clean.value);
    expect(risky.subscores.leverageHistory).toBeLessThan(clean.subscores.leverageHistory);
  });
});

describe('computeSubscores', () => {
  it('returns all five subscores in range', () => {
    const s = computeSubscores(baseInputs());
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
