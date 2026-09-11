import { describe, it, expect } from 'vitest';
import { parseLending, parsePortfolio, parseLiquidations } from './sources';

describe('parseLending', () => {
  it('returns empty (no history) when the account is missing', () => {
    const r = parseLending({ _meta: { block: { number: 100 } } });
    expect(r).toEqual({
      firstActivityBlock: null,
      currentBlock: 100,
      activeDays: 0,
      txCount: 0,
      openBorrowsUsd: 0,
      collateralUsd: 0,
      minHealthFactor: null,
      liquidationCount: 0,
    });
  });

  it('aggregates collateral and borrows in USD from positions', () => {
    const data = {
      _meta: { block: { number: 500 } },
      liquidates: [{ id: 'l1' }], // one liquidation event for this liquidatee
      account: {
        depositCount: 3,
        borrowCount: 2,
        positions: [
          { side: 'LENDER', balance: '1000000000', isCollateral: true, blockNumberOpened: 200, asset: { symbol: 'USDC', decimals: 6, lastPriceUSD: '1' } }, // 1000 USDC collateral
          { side: 'BORROWER', balance: '500000000000000000', isCollateral: false, blockNumberOpened: 250, asset: { symbol: 'WETH', decimals: 18, lastPriceUSD: '2000' } }, // 0.5 WETH borrow = $1000
        ],
      },
    };
    const r = parseLending(data);
    expect(r.currentBlock).toBe(500);
    expect(r.collateralUsd).toBeCloseTo(1000, 6);
    expect(r.openBorrowsUsd).toBeCloseTo(1000, 6);
    expect(r.minHealthFactor).toBeCloseTo(1, 6); // 1000 collateral / 1000 borrows
    expect(r.firstActivityBlock).toBe(200);
    expect(r.txCount).toBe(5);
    expect(r.liquidationCount).toBe(1); // from the liquidates events, not the account counter
  });

  it('sets minHealthFactor null when the account never borrowed', () => {
    const data = {
      _meta: { block: { number: 10 } },
      account: { depositCount: 1, borrowCount: 0, liquidationCount: 0, positions: [{ side: 'LENDER', balance: '1000000', isCollateral: true, blockNumberOpened: 5, asset: { symbol: 'USDC', decimals: 6, lastPriceUSD: '1' } }] },
    };
    expect(parseLending(data).minHealthFactor).toBeNull();
  });
});

describe('parsePortfolio', () => {
  it('maps balances and flags stablecoins (case-insensitive)', () => {
    const p = parsePortfolio({ balances: [
      { symbol: 'usdc', value_usd: 500 },
      { symbol: 'WETH', valueUsd: 1500 },
    ] });
    expect(p).toEqual([
      { symbol: 'USDC', valueUsd: 500, isStablecoin: true },
      { symbol: 'WETH', valueUsd: 1500, isStablecoin: false },
    ]);
  });

  it('handles an array body and drops non-numeric values', () => {
    const p = parsePortfolio([{ symbol: 'DAI', valueUsd: 'nope' }, { symbol: 'USDT', valueUsd: 10 }]);
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual({ symbol: 'USDT', valueUsd: 10, isStablecoin: true });
  });

  it('returns empty for an unrecognized shape', () => {
    expect(parsePortfolio({ nonsense: true })).toEqual([]);
  });
});

describe('parseLiquidations', () => {
  it('extracts lowercased liquidatee addresses with block numbers', () => {
    const data = { liquidates: [
      { blockNumber: '100', liquidatee: { id: '0xAAA' } },
      { blockNumber: 200, liquidatee: { id: '0xbbb' } },
    ] };
    expect(parseLiquidations(data)).toEqual([
      { liquidatee: '0xaaa', blockNumber: 100 },
      { liquidatee: '0xbbb', blockNumber: 200 },
    ]);
  });

  it('drops rows with no liquidatee and returns empty for a missing field', () => {
    expect(parseLiquidations({ liquidates: [{ blockNumber: 1, liquidatee: { id: '' } }] })).toEqual([]);
    expect(parseLiquidations({})).toEqual([]);
  });
});
