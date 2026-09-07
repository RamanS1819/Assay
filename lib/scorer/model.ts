/**
 * Assay deterministic credit-scoring model.
 *
 * The LLM does NOT compute the score. This is pure, explainable arithmetic so a
 * blocked holder can be told exactly why, and an auditor can recompute it. Every
 * output carries subscores, weights, and the block it was computed at.
 *
 *   ScoreInputs (raw facts from The Graph + Token API)
 *        │
 *        ▼   five pure normalizers, each -> 0..100 (100 = safest / most creditworthy)
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ accountMaturity  portfolioQuality  leverageHistory         │
 *   │      0.15             0.25              0.30                │
 *   │            counterpartyHygiene   recentVolatility          │
 *   │                  0.20                 0.10                  │
 *   └───────────────────────────────────────────────────────────┘
 *        │   weighted sum, rounded
 *        ▼
 *   Score.value (0..100) + subscores + weights + asOfBlock + modelVersion
 *
 * Higher is safer. Leverage history carries the most weight because past
 * liquidations are the single strongest signal of counterparty risk.
 */
import type { Score, ScoreInputs, Subscores, Weights } from '../types/index';

export const MODEL_VERSION = '1.0.0';

/** Weights sum to 1.0. */
export const WEIGHTS: Weights = {
  accountMaturity: 0.15,
  portfolioQuality: 0.25,
  leverageHistory: 0.3,
  counterpartyHygiene: 0.2,
  recentVolatility: 0.1,
};

// --- tunable thresholds (explicit so tests and auditors can see them) ---
export const BLOCKS_PER_YEAR = 2_628_000; // ~12s Ethereum blocks
const ACTIVE_DAYS_FULL = 180;
const TX_COUNT_FULL = 500;
const PORTFOLIO_SIZE_FULL_USD = 100_000;
const LIQUIDATION_PENALTY = 40; // points removed per liquidation
const HEALTH_FACTOR_SAFE = 2; // HF >= 2 -> 100
const NEVER_BORROWED_SCORE = 80; // never took leverage -> good, not perfect
const FLAGGED_PENALTY = 25; // points removed per flagged counterparty

export function clamp(x: number, lo = 0, hi = 100): number {
  if (Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

export function normalizeAccountMaturity(m: ScoreInputs['accountMaturity']): number {
  const ageBlocks = Math.max(0, m.currentBlock - m.firstSeenBlock);
  const ageScore = clamp((ageBlocks / BLOCKS_PER_YEAR) * 100);
  const activityScore = clamp((m.activeDays / ACTIVE_DAYS_FULL) * 100);
  const txScore = clamp((m.txCount / TX_COUNT_FULL) * 100);
  return clamp(0.5 * ageScore + 0.3 * activityScore + 0.2 * txScore);
}

export function normalizePortfolioQuality(p: ScoreInputs['portfolio']): number {
  if (p.totalUsd <= 0) return 0; // no portfolio -> cannot assess -> lowest
  const stableScore = clamp((p.stablecoinUsd / p.totalUsd) * 100);
  const concentration = clamp((p.largestPositionUsd / p.totalUsd) * 100);
  const diversScore = clamp(100 - concentration);
  const sizeScore = clamp((p.totalUsd / PORTFOLIO_SIZE_FULL_USD) * 100);
  return clamp(0.4 * stableScore + 0.4 * diversScore + 0.2 * sizeScore);
}

export function normalizeLeverageHistory(l: ScoreInputs['leverage']): number {
  const liqScore = clamp(100 - l.liquidationCount * LIQUIDATION_PENALTY);
  const healthScore =
    l.minHealthFactor === null
      ? NEVER_BORROWED_SCORE
      : clamp(((l.minHealthFactor - 1) / (HEALTH_FACTOR_SAFE - 1)) * 100);
  const utilization = l.collateralUsd > 0 ? l.openBorrowsUsd / l.collateralUsd : 0;
  const utilScore = clamp((1 - utilization) * 100);
  return clamp(0.5 * liqScore + 0.3 * healthScore + 0.2 * utilScore);
}

export function normalizeCounterpartyHygiene(c: ScoreInputs['counterparty']): number {
  if (c.flaggedInteractionCount <= 0) return 100;
  return clamp(100 - c.flaggedInteractionCount * FLAGGED_PENALTY);
}

export function normalizeRecentVolatility(v: ScoreInputs['volatility']): number {
  // 0% swing = perfectly stable = 100; larger swings reduce the score linearly.
  return clamp(100 - v.balanceStdDevPct);
}

export function computeSubscores(inputs: ScoreInputs): Subscores {
  return {
    accountMaturity: normalizeAccountMaturity(inputs.accountMaturity),
    portfolioQuality: normalizePortfolioQuality(inputs.portfolio),
    leverageHistory: normalizeLeverageHistory(inputs.leverage),
    counterpartyHygiene: normalizeCounterpartyHygiene(inputs.counterparty),
    recentVolatility: normalizeRecentVolatility(inputs.volatility),
  };
}

export interface ScoreMeta {
  address: string;
  chain: string;
  asOfBlock: number;
  /** Which data sources actually contributed, e.g. ["messari-lending","token-api"]. */
  inputs: string[];
  /** ISO timestamp; defaults to now. Passed in for deterministic tests. */
  computedAt?: string;
}

export function computeScore(inputs: ScoreInputs, meta: ScoreMeta): Score {
  const subscores = computeSubscores(inputs);
  const value = Math.round(
    subscores.accountMaturity * WEIGHTS.accountMaturity +
      subscores.portfolioQuality * WEIGHTS.portfolioQuality +
      subscores.leverageHistory * WEIGHTS.leverageHistory +
      subscores.counterpartyHygiene * WEIGHTS.counterpartyHygiene +
      subscores.recentVolatility * WEIGHTS.recentVolatility,
  );
  return {
    address: meta.address,
    chain: meta.chain,
    value: clamp(value),
    subscores,
    weights: WEIGHTS,
    asOfBlock: meta.asOfBlock,
    computedAt: meta.computedAt ?? new Date().toISOString(),
    inputs: meta.inputs,
    modelVersion: MODEL_VERSION,
  };
}
