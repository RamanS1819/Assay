/**
 * Score cache keyed by (address, block bucket). Two jobs:
 *   1. model freshness — a score is reused only within a block window + TTL
 *   2. query budget — this is what keeps Graph usage flat (see plan §3)
 *
 * In-memory for now; the `ScoreCache` interface lets a DB-backed cache drop in later.
 */
import type { Score } from '../types/index';

/** ~1 hour of Ethereum blocks. Scores computed in the same bucket are reused. */
export const BLOCK_RANGE = 300;

export function cacheKey(address: string, atBlock: number, blockRange = BLOCK_RANGE): string {
  const bucket = Math.floor(atBlock / blockRange);
  return `${address.toLowerCase()}:${bucket}`;
}

export interface ScoreCache {
  get(key: string): Score | undefined;
  set(key: string, score: Score): void;
}

interface Entry {
  score: Score;
  expiresAt: number;
}

export class InMemoryScoreCache implements ScoreCache {
  private store = new Map<string, Entry>();

  constructor(
    private ttlMs = 5 * 60_000,
    private now: () => number = Date.now,
  ) {}

  get(key: string): Score | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (this.now() >= e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e.score;
  }

  set(key: string, score: Score): void {
    this.store.set(key, { score, expiresAt: this.now() + this.ttlMs });
  }
}
