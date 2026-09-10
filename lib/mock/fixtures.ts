/**
 * Fixture chain state for the offline demo. Three wallets with distinct profiles,
 * and a MockChain that can advance blocks and simulate a liquidation (which mutates
 * the subject so a re-score drops it — the trigger for beat 5).
 *
 * These are the same shapes the live Graph fetchers produce, so the mock adapters
 * are drop-in for the real ones.
 */
import type { RawLendingData, RawPortfolio, LiquidationEvent } from '../scorer/sources';

export const ADDR = {
  whale: '0x1111111111111111111111111111111111111111', // mature, diversified, no leverage -> high
  fresh: '0x2222222222222222222222222222222222222222', // thin history -> low
  distressed: '0x3333333333333333333333333333333333333333', // healthy until it gets liquidated
} as const;

const norm = (a: string) => a.toLowerCase();

export interface Profile {
  lending: RawLendingData;
  portfolio: RawPortfolio;
}

const START_BLOCK = 2_628_000;

function whale(): Profile {
  return {
    lending: { firstActivityBlock: START_BLOCK - 2_628_000, currentBlock: START_BLOCK, activeDays: 300, txCount: 800, openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 },
    portfolio: [
      { symbol: 'USDC', valueUsd: 250_000, isStablecoin: true },
      { symbol: 'WETH', valueUsd: 150_000, isStablecoin: false },
      { symbol: 'WBTC', valueUsd: 100_000, isStablecoin: false },
    ],
  };
}

function fresh(): Profile {
  return {
    lending: { firstActivityBlock: START_BLOCK - 5_000, currentBlock: START_BLOCK, activeDays: 4, txCount: 3, openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 },
    portfolio: [{ symbol: 'PEPE', valueUsd: 2_000, isStablecoin: false }],
  };
}

function distressed(): Profile {
  return {
    lending: { firstActivityBlock: START_BLOCK - 1_000_000, currentBlock: START_BLOCK, activeDays: 120, txCount: 90, openBorrowsUsd: 40_000, collateralUsd: 80_000, minHealthFactor: 1.8, liquidationCount: 0 },
    portfolio: [
      { symbol: 'USDC', valueUsd: 30_000, isStablecoin: true },
      { symbol: 'WETH', valueUsd: 50_000, isStablecoin: false },
    ],
  };
}

export class MockChain {
  currentBlock: number;
  private profiles = new Map<string, Profile>();
  private liquidations: LiquidationEvent[] = [];

  constructor(startBlock = START_BLOCK) {
    this.currentBlock = startBlock;
  }

  seed(address: string, profile: Profile): void {
    this.profiles.set(norm(address), profile);
  }

  advance(blocks: number): void {
    this.currentBlock += blocks;
  }

  headBlock(): number {
    return this.currentBlock;
  }

  lending(address: string): RawLendingData {
    const p = this.profiles.get(norm(address));
    if (!p) return { firstActivityBlock: null, currentBlock: this.currentBlock, activeDays: 0, txCount: 0, openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 };
    return { ...p.lending, currentBlock: this.currentBlock };
  }

  portfolio(address: string): RawPortfolio {
    return this.profiles.get(norm(address))?.portfolio ?? [];
  }

  /** Simulate a liquidation: record the event and mutate the subject into distress. */
  liquidate(address: string): void {
    const a = norm(address);
    this.liquidations.push({ liquidatee: a, blockNumber: this.currentBlock });
    const p = this.profiles.get(a);
    if (p) {
      p.lending = {
        ...p.lending,
        liquidationCount: p.lending.liquidationCount + 1,
        minHealthFactor: 1.0,
        openBorrowsUsd: p.lending.collateralUsd * 0.98,
      };
    }
  }

  liquidationsSince(fromBlock: number, toBlock: number): LiquidationEvent[] {
    return this.liquidations.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
  }
}

/** A chain seeded with the three demo wallets. */
export function demoChain(): MockChain {
  const chain = new MockChain();
  chain.seed(ADDR.whale, whale());
  chain.seed(ADDR.fresh, fresh());
  chain.seed(ADDR.distressed, distressed());
  return chain;
}
