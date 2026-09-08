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

export interface UnderwriteRequest {
  score: Score;
  exposureUnits: number; // units the subject currently holds
  requestedUnits: number; // units the subject is asking for
  policy: Policy;
  maxLimitUnits: number;
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

  // Denied while the subject still holds units = a revocation (downgrade).
  const revokes = result.limit === 0 && req.exposureUnits > 0;

  return {
    subject: req.score.address,
    limit: result.limit,
    rationale: result.rationale,
    scoreRef: { address: req.score.address, asOfBlock: req.score.asOfBlock, value: req.score.value },
    revokes,
    escalated: needsEscalation({ limit: result.limit, revokes }, req.policy),
  };
}
