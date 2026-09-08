/**
 * Executor — applies an underwriting decision to the on-chain control list.
 *
 *   decision ──▶ ControlAction (issue | revoke)
 *                     │
 *                     ▼
 *        Executor.execute()  = Privy signs -> broadcast to Hedera RPC -> WAIT for confirmation
 *                     │  (resolves ONLY after the tx confirms — on-chain is the source of truth)
 *                     ▼
 *              audit(execution, txHash)
 *
 * The real Executor (Privy sign + Hedera broadcast + wait) is injected. Here we own
 * the mapping and the audit trail, both testable with a mock executor.
 */
import type { UnderwritingDecision, AuditEvent } from '../types/index';

export type ControlAction =
  | { kind: 'issue'; subject: string; units: number }
  | { kind: 'revoke'; subject: string };

export function decisionToAction(d: UnderwritingDecision): ControlAction {
  if (d.revokes) return { kind: 'revoke', subject: d.subject };
  return { kind: 'issue', subject: d.subject, units: d.limit };
}

export interface Executor {
  /** Sign + broadcast + WAIT for confirmation. Resolves with the confirmed tx hash. */
  execute(action: ControlAction): Promise<string>;
}

export interface ExecuteDeps {
  executor: Executor;
  audit(event: AuditEvent): Promise<void>;
  now?: () => string;
}

export async function applyDecision(decision: UnderwritingDecision, deps: ExecuteDeps): Promise<string> {
  const action = decisionToAction(decision);
  const txHash = await deps.executor.execute(action); // only after on-chain confirmation
  await deps.audit({
    type: 'execution',
    txHash,
    action: action.kind === 'issue' ? 'issue' : 'revoke',
    subject: decision.subject,
    at: (deps.now ?? (() => new Date().toISOString()))(),
  });
  return txHash;
}
