import { describe, it, expect } from 'vitest';
import { aggregatePortfolio, toScoreInputs, contributingSources, type MapArgs } from './map';
import type { RawLendingData, RawPortfolio } from './sources';

const lending: RawLendingData = {
  firstActivityBlock: 100,
  currentBlock: 2_628_100,
  activeDays: 90,
  txCount: 40,
  openBorrowsUsd: 0,
  collateralUsd: 0,
  minHealthFactor: null,
  liquidationCount: 0,
};

describe('aggregatePortfolio', () => {
  it('sums totals, stablecoin value, and finds the largest position', () => {
    const p: RawPortfolio = [
      { symbol: 'USDC', valueUsd: 4000, isStablecoin: true },
      { symbol: 'WETH', valueUsd: 6000, isStablecoin: false },
      { symbol: 'PEPE', valueUsd: 0, isStablecoin: false }, // zero-value, filtered
    ];
    expect(aggregatePortfolio(p)).toEqual({ totalUsd: 10000, stablecoinUsd: 4000, largestPositionUsd: 6000, positionCount: 2 });
  });

  it('returns zeros for an empty book', () => {
    expect(aggregatePortfolio([])).toEqual({ totalUsd: 0, stablecoinUsd: 0, largestPositionUsd: 0, positionCount: 0 });
  });
});

describe('toScoreInputs', () => {
  it('passes leverage through and defaults counterparty + volatility to neutral', () => {
    const args: MapArgs = { lending, portfolio: [{ symbol: 'USDC', valueUsd: 100, isStablecoin: true }] };
    const inputs = toScoreInputs(args);
    expect(inputs.leverage).toEqual({ openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 });
    // Absent counterparty -> zero total (read downstream as "no data" -> neutral 50).
    expect(inputs.counterparty).toEqual({ flaggedInteractionCount: 0, totalCounterparties: 0 });
    // Unmeasured volatility defaults to a neutral swing (50 -> subscore 50), not 0 (-> 100).
    expect(inputs.volatility).toEqual({ balanceStdDevPct: 50 });
    expect(inputs.accountMaturity.firstSeenBlock).toBe(100);
  });

  it('falls back firstSeenBlock to currentBlock when there is no lending history', () => {
    const noHistory: RawLendingData = { ...lending, firstActivityBlock: null };
    const inputs = toScoreInputs({ lending: noHistory, portfolio: [] });
    expect(inputs.accountMaturity.firstSeenBlock).toBe(noHistory.currentBlock);
  });
});

describe('contributingSources', () => {
  it('always includes the two core Graph products, plus optional signals', () => {
    expect(contributingSources({ lending, portfolio: [] })).toEqual(['messari-lending', 'token-api']);
    expect(contributingSources({ lending, portfolio: [], counterparty: { flaggedInteractionCount: 0, totalCounterparties: 3 }, balanceStdDevPct: 5 })).toEqual([
      'messari-lending', 'token-api', 'counterparty', 'volatility',
    ]);
  });
});
