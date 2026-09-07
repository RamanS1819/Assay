/**
 * The watcher — critical gap #1. One global liquidation query, a durable cursor.
 *
 *   cursor.get() = last processed block
 *        │
 *        ▼
 *   toBlock = head - confirmationLag        (stay below the head: indexing lag / reorgs)
 *   fromBlock = cursor + 1
 *        │
 *   fromBlock > toBlock ? ─yes─▶ nothing new; DON'T advance, DON'T query
 *        │no
 *        ▼
 *   fetchLiquidations(fromBlock, toBlock)   (throws? cursor NOT advanced -> retried)
 *        ▼
 *   cursor.set(toBlock)                     (advance ONLY after a successful fetch)
 *        ▼
 *   return unique affected liquidatees
 *
 * On restart the cursor is read from the store, so blocks are never skipped and
 * never reprocessed.
 */
import type { CursorStore } from './store';
import type { LiquidationEvent } from '../scorer/sources';

/** Stay this many blocks below head to avoid indexing lag / shallow reorgs. */
export const DEFAULT_CONFIRMATION_LAG = 5;

export interface WatcherDeps {
  fetchLiquidations(fromBlock: number, toBlock: number): Promise<LiquidationEvent[]>;
  headBlock(): Promise<number>;
  cursor: CursorStore;
  confirmationLag?: number;
}

export interface WatchResult {
  affected: string[];
  fromBlock: number;
  toBlock: number;
  advanced: boolean;
}

export async function pollLiquidations(deps: WatcherDeps): Promise<WatchResult> {
  const lag = deps.confirmationLag ?? DEFAULT_CONFIRMATION_LAG;
  const head = await deps.headBlock();
  const toBlock = Math.max(0, head - lag);
  const last = await deps.cursor.get();
  const fromBlock = last + 1;

  if (fromBlock > toBlock) {
    // head hasn't advanced past the lag window yet — nothing to do
    return { affected: [], fromBlock, toBlock: last, advanced: false };
  }

  const events = await deps.fetchLiquidations(fromBlock, toBlock);
  const affected = [...new Set(events.map((e) => e.liquidatee.toLowerCase()))];

  // Advance ONLY after a successful fetch. If fetchLiquidations throws, this line
  // never runs and the same range is retried on the next poll.
  await deps.cursor.set(toBlock);

  return { affected, fromBlock, toBlock, advanced: true };
}
