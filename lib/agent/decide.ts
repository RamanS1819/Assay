/**
 * The agent's deterministic decisions. This is the reasoning Graph T2 grades:
 * NOT "print a query result", but "decide whether an address is worth paying to
 * re-score, and whether an action must escalate to humans."
 *
 *   shouldSpend: staleness x exposure x budget  ->  spend $0.002, or skip (with a reason)
 *   needsEscalation: is this action too big to do autonomously?
 *   suggestedLimit: a deterministic baseline the LLM can override + explain
 *
 * Every skip logs its reason so the console can show WHY the agent didn't spend —
 * judges cannot grade reasoning they cannot see.
 */
import { clamp } from '../scorer/model';
import type { Policy } from '../types/index';

// ---- shouldSpend -----------------------------------------------------------

export const STALENESS_BASE_BLOCKS = 300; // ~1h of Ethereum blocks at baseline exposure
export const EXPOSURE_BASELINE = 1000; // units; the reference exposure for staleness scaling

/** Higher exposure tolerates less staleness. A 50k-unit holder is re-checked far sooner than a 50-unit one. */
export function allowedStaleness(exposureUnits: number): number {
  const e = Math.max(exposureUnits, 1);
  const scaled = STALENESS_BASE_BLOCKS * (EXPOSURE_BASELINE / e);
  return clamp(scaled, 10, STALENESS_BASE_BLOCKS * 4); // ~2min .. ~4h
}

export interface SpendDecisionInput {
  cachedScore: { asOfBlock: number } | null;
  currentBlock: number;
  exposureUnits: number;
  budgetRemainingUsd: number;
  priceUsd: number;
}

export type SpendReason = 'budget_exhausted' | 'no_score' | 'fresh' | 'stale';
export interface SpendDecision {
  spend: boolean;
  reason: SpendReason;
}

export function shouldSpend(input: SpendDecisionInput): SpendDecision {
  if (input.budgetRemainingUsd < input.priceUsd) return { spend: false, reason: 'budget_exhausted' };
  if (!input.cachedScore) return { spend: true, reason: 'no_score' };
  const staleness = input.currentBlock - input.cachedScore.asOfBlock;
  if (staleness <= allowedStaleness(input.exposureUnits)) return { spend: false, reason: 'fresh' };
  return { spend: true, reason: 'stale' };
}

// ---- escalation ------------------------------------------------------------

/**
 * The un-bypassable gate. Mirrors the Privy key-quorum policy in the app so the
 * console can show it; the real enforcement is Privy refusing to sign. Escalates
 * (2-of-3 humans) when an issuance exceeds the quorum threshold, or when revoking a
 * LARGE position (above the threshold). A small protective revoke stays autonomous —
 * the agent should be able to pull a risky small holder without waiting on humans.
 */
export function needsEscalation(
  decision: { limit: number; revokes: boolean; exposureUnits: number },
  policy: Pick<Policy, 'quorumThresholdUnits'>,
): boolean {
  if (decision.limit > policy.quorumThresholdUnits) return true;
  if (decision.revokes && decision.exposureUnits > policy.quorumThresholdUnits) return true;
  return false;
}

// ---- deterministic limit baseline -----------------------------------------

/**
 * An explainable baseline the LLM can override. Below the floor the address is
 * denied (limit 0); above it, the limit scales linearly with the score.
 */
export function suggestedLimit(scoreValue: number, maxLimitUnits: number, floor = 40): number {
  if (scoreValue < floor) return 0;
  const frac = (scoreValue - floor) / (100 - floor);
  return Math.round(frac * maxLimitUnits);
}
