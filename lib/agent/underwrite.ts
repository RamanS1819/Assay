/**
 * Underwriting — the LLM decides the credit limit and writes the rationale a human
 * reviewer reads. It does NOT compute the score (that is deterministic arithmetic).
 *
 * Two guards make this safe:
 *   - sanitize(): the LLM's limit is clamped to [0, maxLimit]. We never trust a model
 *     to respect the bound — a hallucinated or prompt-injected limit cannot over-issue.
 *   - fallbackUnderwrite(): if the provider errors or is absent, a deterministic
 *     baseline (suggestedLimit) is used, so the loop never stalls on a flaky LLM.
 */
import type { Score, UnderwritingDecision, Policy } from '../types/index';
import { suggestedLimit, needsEscalation } from './decide';

/** A holder whose score drops below this is revoked, even if the raw limit is > 0. */
export const MAINTENANCE_FLOOR = 50;

export interface UnderwriteRequest {
  score: Score;
  exposureUnits: number; // units the subject currently holds
  requestedUnits: number; // units the subject is asking for
  policy: Policy;
  maxLimitUnits: number;
  revokeBelowScore?: number; // maintenance floor override
}

/** The LLM behind an interface (Groq primary, Gemini spare, Ollama fallback). */
export interface UnderwriteProvider {
  underwrite(req: UnderwriteRequest): Promise<{ limit: number; rationale: string }>;
}

export function fallbackUnderwrite(req: UnderwriteRequest): { limit: number; rationale: string } {
  const limit = suggestedLimit(req.score.value, req.maxLimitUnits);
  const rationale =
    limit === 0
      ? `Denied: score ${req.score.value} below floor (leverage ${req.score.subscores.leverageHistory}/100).`
      : `Limit ${limit} units from score ${req.score.value} (leverage ${req.score.subscores.leverageHistory}, portfolio ${req.score.subscores.portfolioQuality}).`;
  return { limit, rationale };
}

/** Never trust the model to respect bounds: clamp the limit, bound the rationale. */
function sanitize(raw: { limit: number; rationale: string }, req: UnderwriteRequest): { limit: number; rationale: string } {
  const n = Number(raw?.limit);
  const limit = Number.isFinite(n) ? Math.max(0, Math.min(Math.round(n), req.maxLimitUnits)) : 0;
  const rationale = String(raw?.rationale ?? '').slice(0, 500) || 'No rationale provided.';
  return { limit, rationale };
}

export async function underwrite(req: UnderwriteRequest, provider?: UnderwriteProvider): Promise<UnderwritingDecision> {
  let result: { limit: number; rationale: string };
  if (provider) {
    try {
      result = sanitize(await provider.underwrite(req), req);
    } catch {
      result = fallbackUnderwrite(req); // flaky LLM -> deterministic baseline
    }
  } else {
    result = fallbackUnderwrite(req);
  }

  // A current holder is revoked if denied (limit 0) OR if the fresh score falls below
  // the maintenance floor — the bureau pulls the line when creditworthiness drops.
  const belowMaintenance = req.score.value < (req.revokeBelowScore ?? MAINTENANCE_FLOOR);
  const revokes = req.exposureUnits > 0 && (result.limit === 0 || belowMaintenance);
  const limit = revokes ? 0 : result.limit;

  return {
    subject: req.score.address,
    limit,
    rationale: result.rationale,
    scoreRef: { address: req.score.address, asOfBlock: req.score.asOfBlock, value: req.score.value },
    revokes,
    escalated: needsEscalation({ limit, revokes, exposureUnits: req.exposureUnits }, req.policy),
  };
}
