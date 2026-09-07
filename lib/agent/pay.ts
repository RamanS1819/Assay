/**
 * Idempotent x402 payment — critical gap #2.
 *
 * A score purchase is keyed by (subject, block bucket): the same key is never
 * paid twice. The intent is recorded BEFORE paying, so a crash between "pay" and
 * "record the receipt" is recoverable — startup reconciliation checks the chain
 * for pending intents rather than blindly re-paying.
 *
 *   payForScore(subject, key)
 *     find(key) settled? ──yes──▶ return cached txHash          (crash-after-settle safe)
 *        │no
 *        ▼
 *     create(key) if absent      (record intent BEFORE paying)
 *        ▼
 *     settle()  -> txHash        (Privy signs, Blocky402 broadcasts)
 *        ▼
 *     markSettled(key, txHash)
 */
import { cacheKey } from '../scorer/cache';
import type { IntentStore } from './store';

/** The idempotency key for one score purchase: (subject, block bucket). */
export function paymentKey(subject: string, atBlock: number, blockRange?: number): string {
  return cacheKey(subject, atBlock, blockRange);
}

export interface PayResult {
  txHash: string;
  alreadySettled: boolean;
}

export interface PayDeps {
  intents: IntentStore;
  /** Performs the real x402 payment (Privy sign -> Blocky402 settle) and returns a tx hash. */
  settle(subject: string, key: string): Promise<string>;
}

export async function payForScore(subject: string, key: string, deps: PayDeps): Promise<PayResult> {
  const existing = await deps.intents.find(key);
  if (existing?.status === 'settled' && existing.txHash) {
    return { txHash: existing.txHash, alreadySettled: true };
  }
  if (!existing) {
    await deps.intents.create(key); // record intent BEFORE paying
  }
  const txHash = await deps.settle(subject, key);
  await deps.intents.markSettled(key, txHash);
  return { txHash, alreadySettled: false };
}

export interface ReconcileDeps {
  intents: IntentStore;
  /** Check the chain: did the payment for this key actually settle? Returns the tx hash or null. */
  reconcile(key: string): Promise<string | null>;
}

/** Run on startup: mark any pending-but-actually-settled intents, so we never re-pay them. */
export async function reconcilePending(deps: ReconcileDeps): Promise<number> {
  const pending = await deps.intents.listPending();
  let fixed = 0;
  for (const p of pending) {
    const txHash = await deps.reconcile(p.key);
    if (txHash) {
      await deps.intents.markSettled(p.key, txHash);
      fixed++;
    }
  }
  return fixed;
}
