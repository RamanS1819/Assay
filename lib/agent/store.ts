/**
 * Persistence the agent depends on, as narrow interfaces. In-memory impls run
 * the tests; a Neon-backed impl drops in later without touching the loop logic.
 *
 * Two stores exist to close the eng-review's critical gaps:
 *   - CursorStore  -> the watcher's durable position (no missed / double-processed blocks)
 *   - IntentStore  -> x402 payment idempotency (no double-spend on crash-restart)
 */

// ---- watcher cursor --------------------------------------------------------

export interface CursorStore {
  /** Last fully-processed block. 0 = nothing processed yet. */
  get(): Promise<number>;
  set(block: number): Promise<void>;
}

export class InMemoryCursorStore implements CursorStore {
  constructor(private block = 0) {}
  async get(): Promise<number> {
    return this.block;
  }
  async set(block: number): Promise<void> {
    this.block = block;
  }
}

// ---- payment intents (idempotency ledger) ----------------------------------

export type IntentStatus = 'pending' | 'settled';

export interface PaymentIntent {
  key: string; // one score purchase: `${subject}:${blockBucket}`
  status: IntentStatus;
  txHash?: string;
  createdAt: number;
}

export interface IntentStore {
  find(key: string): Promise<PaymentIntent | undefined>;
  /** Record intent BEFORE paying, so a crash mid-payment is recoverable. */
  create(key: string): Promise<PaymentIntent>;
  markSettled(key: string, txHash: string): Promise<void>;
  /** Intents that were started but never confirmed — reconciled on startup. */
  listPending(): Promise<PaymentIntent[]>;
}

export class InMemoryIntentStore implements IntentStore {
  private map = new Map<string, PaymentIntent>();
  constructor(private now: () => number = Date.now) {}

  async find(key: string): Promise<PaymentIntent | undefined> {
    return this.map.get(key);
  }
  async create(key: string): Promise<PaymentIntent> {
    const intent: PaymentIntent = { key, status: 'pending', createdAt: this.now() };
    this.map.set(key, intent);
    return intent;
  }
  async markSettled(key: string, txHash: string): Promise<void> {
    const intent = this.map.get(key);
    if (intent) {
      intent.status = 'settled';
      intent.txHash = txHash;
    }
  }
  async listPending(): Promise<PaymentIntent[]> {
    return [...this.map.values()].filter((i) => i.status === 'pending');
  }
}
