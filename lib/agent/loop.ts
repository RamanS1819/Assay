/**
 * The agent loop — one cycle. This is the brain: watch -> for each subject decide
 * whether to spend, buy the score, underwrite, then escalate or execute.
 *
 *   for each subject:
 *     shouldSpend? ──no──▶ audit(skip, reason)                    [budget/fresh]
 *        │yes
 *        ▼
 *     buyScore()  (idempotent pay + fresh score)   budget.spend(price)
 *        ▼
 *     underwrite()  -> decision (limit, rationale, revokes, escalated)
 *        ▼
 *     escalated? ──yes──▶ enqueueApproval()  (2-of-3 humans; Privy quorum enforces)
 *        │no
 *        ▼
 *     execute()  (issue/revoke on-chain)
 *
 * Every branch is audited so the console can show WHY the agent did what it did.
 * All operations are injected; the app (scripts/agent.ts) wires the real ones.
 */
import type { Score, UnderwritingDecision, AuditEvent } from '../types/index';
import { shouldSpend } from './decide';

export interface Subject {
  address: string;
  exposureUnits: number;
  requestedUnits: number;
}

export interface Budget {
  remainingToday(): number;
  spend(usd: number): void;
}

export class SimpleBudget implements Budget {
  private spent = 0;
  constructor(private dailyCapUsd: number) {}
  remainingToday(): number {
    return Math.max(0, this.dailyCapUsd - this.spent);
  }
  spend(usd: number): void {
    this.spent += usd;
  }
}

export interface LoopOps {
  /** Cache-only read of the subject's current score (for the spend decision). */
  peekScore(address: string, atBlock: number): { asOfBlock: number } | null;
  /** Idempotent pay + fresh score fetch. Audits its own payment + score events. */
  buyScore(subject: Subject, atBlock: number): Promise<{ score: Score }>;
  underwrite(score: Score, subject: Subject): Promise<UnderwritingDecision>;
  execute(decision: UnderwritingDecision): Promise<string>;
  enqueueApproval(decision: UnderwritingDecision): Promise<void>;
  audit(event: AuditEvent): Promise<void>;
}

export interface LoopConfig {
  price: number;
  budget: Budget;
  now?: () => string;
}

export interface CycleResult {
  scored: string[];
  issued: string[];
  escalated: string[];
  skipped: { subject: string; reason: string }[];
}

export async function runCycle(subjects: Subject[], atBlock: number, ops: LoopOps, cfg: LoopConfig): Promise<CycleResult> {
  const now = cfg.now ?? (() => new Date().toISOString());
  const result: CycleResult = { scored: [], issued: [], escalated: [], skipped: [] };

  for (const subject of subjects) {
    const spend = shouldSpend({
      cachedScore: ops.peekScore(subject.address, atBlock),
      currentBlock: atBlock,
      exposureUnits: subject.exposureUnits,
      budgetRemainingUsd: cfg.budget.remainingToday(),
      priceUsd: cfg.price,
    });

    if (!spend.spend) {
      await ops.audit({ type: 'skip', subject: subject.address, reason: spend.reason, at: now() });
      result.skipped.push({ subject: subject.address, reason: spend.reason });
      continue;
    }

    const { score } = await ops.buyScore(subject, atBlock);
    cfg.budget.spend(cfg.price);
    result.scored.push(subject.address);

    const decision = await ops.underwrite(score, subject);
    await ops.audit({ type: 'decision', subject: subject.address, limit: decision.limit, escalated: decision.escalated, at: now() });

    if (decision.escalated) {
      await ops.enqueueApproval(decision);
      result.escalated.push(subject.address);
      continue;
    }

    await ops.execute(decision);
    result.issued.push(subject.address);
  }

  return result;
}
