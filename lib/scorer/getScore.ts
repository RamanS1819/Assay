/**
 * getScore — orchestrates the scorer:
 *
 *   cache hit? ──yes──▶ return cached Score            (no query spent)
 *      │no
 *      ▼
 *   fetch lending + portfolio (+ counterparty) in parallel
 *      ▼
 *   map -> ScoreInputs -> computeScore (deterministic)
 *      ▼
 *   cache.set, return
 *
 * Dependencies are injected so the whole flow is testable with mocks and no network.
 * The caller passes `atBlock` (the agent knows it from its watch cursor; the gateway
 * fetches the head block) so the cache keys by block without an extra query.
 */
import type { Score } from '../types/index';
import { computeScore } from './model';
import { toScoreInputs, contributingSources, type MapArgs } from './map';
import { cacheKey, BLOCK_RANGE, type ScoreCache } from './cache';
import type { RawLendingData, RawPortfolio, CounterpartyData } from './sources';

export interface ScoreDeps {
  fetchLending(address: string): Promise<RawLendingData>;
  fetchPortfolio(address: string): Promise<RawPortfolio>;
  fetchCounterparty?(address: string): Promise<CounterpartyData>;
  cache: ScoreCache;
}

export interface GetScoreOpts {
  atBlock: number;
  chain: string;
  blockRange?: number;
}

export async function getScore(address: string, opts: GetScoreOpts, deps: ScoreDeps): Promise<Score> {
  const key = cacheKey(address, opts.atBlock, opts.blockRange ?? BLOCK_RANGE);
  const cached = deps.cache.get(key);
  if (cached) return cached;

  const [lending, portfolio, counterparty] = await Promise.all([
    deps.fetchLending(address),
    deps.fetchPortfolio(address),
    deps.fetchCounterparty ? deps.fetchCounterparty(address) : Promise.resolve(undefined),
  ]);

  const mapArgs: MapArgs = { lending, portfolio, counterparty };
  const score = computeScore(toScoreInputs(mapArgs), {
    address,
    chain: opts.chain,
    asOfBlock: opts.atBlock,
    inputs: contributingSources(mapArgs),
  });

  deps.cache.set(key, score);
  return score;
}
