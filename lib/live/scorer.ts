/**
 * Live scorer wiring — assembles ScoreDeps from the real Graph source functions.
 * Drop-in for mockScoreDeps: same ScoreDeps shape, so getScore() and the agent
 * loop don't change. Reads GRAPH_* from env (see sources.ts).
 */
import type { ScoreDeps } from '../scorer/getScore';
import { InMemoryScoreCache } from '../scorer/cache';
import { fetchLending, fetchPortfolio, fetchHeadBlock, type RawPortfolio } from '../scorer/sources';

/**
 * Neutral portfolio used when the Token API (GRAPH_TOKEN_API_URL) isn't connected.
 * Tuned so portfolioQuality resolves to ~50 — it neither inflates nor drags the
 * score, so live numbers stay sane without the 25% portfolio signal dropping to 0.
 * Replace with real fetchPortfolio once the Token API (Pinax) is wired.
 */
export const NEUTRAL_PORTFOLIO: RawPortfolio = [
  { symbol: 'USDC', valueUsd: 25_000, isStablecoin: true },
  { symbol: 'WETH', valueUsd: 25_000, isStablecoin: false },
];

export function makeLiveScoreDeps(cache: InMemoryScoreCache = new InMemoryScoreCache()): ScoreDeps {
  const hasTokenApi = Boolean(process.env.GRAPH_TOKEN_API_URL);
  return {
    fetchLending,
    fetchPortfolio: hasTokenApi ? fetchPortfolio : async () => NEUTRAL_PORTFOLIO,
    cache,
  };
}

export { fetchHeadBlock as liveHeadBlock };
