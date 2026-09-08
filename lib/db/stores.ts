/**
 * Neon-backed implementations of the agent's persistence interfaces. The `sql`
 * tagged-template client is injected, so the row mapping is unit-tested with a mock
 * and the same class runs live against Neon in the app.
 */
import type { CursorStore, IntentStore, PaymentIntent, IntentStatus } from '../agent/store';

/** The neon() client shape: sql`...` -> Promise<rows[]>. */
export type Sql = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

export class DbCursorStore implements CursorStore {
  constructor(private sql: Sql, private id = 'liquidations') {}

  async get(): Promise<number> {
    const rows = await this.sql<{ block: string | number }>`SELECT block FROM agent_cursor WHERE id = ${this.id}`;
    return rows[0] ? Number(rows[0].block) : 0;
  }

  async set(block: number): Promise<void> {
    await this.sql`
      INSERT INTO agent_cursor (id, block) VALUES (${this.id}, ${block})
      ON CONFLICT (id) DO UPDATE SET block = ${block}`;
  }
}

interface IntentRow {
  key: string;
  status: string;
  tx_hash: string | null;
  created_at: string | Date;
}

export class DbIntentStore implements IntentStore {
  constructor(private sql: Sql) {}

  private map(r: IntentRow): PaymentIntent {
    return {
      key: r.key,
      status: r.status as IntentStatus,
      txHash: r.tx_hash ?? undefined,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    };
  }

  async find(key: string): Promise<PaymentIntent | undefined> {
    const rows = await this.sql<IntentRow>`SELECT key, status, tx_hash, created_at FROM payment_intents WHERE key = ${key}`;
    return rows[0] ? this.map(rows[0]) : undefined;
  }

  async create(key: string): Promise<PaymentIntent> {
    const rows = await this.sql<IntentRow>`
      INSERT INTO payment_intents (key, status) VALUES (${key}, 'pending')
      RETURNING key, status, tx_hash, created_at`;
    return this.map(rows[0]);
  }

  async markSettled(key: string, txHash: string): Promise<void> {
    await this.sql`UPDATE payment_intents SET status = 'settled', tx_hash = ${txHash} WHERE key = ${key}`;
  }

  async listPending(): Promise<PaymentIntent[]> {
    const rows = await this.sql<IntentRow>`SELECT key, status, tx_hash, created_at FROM payment_intents WHERE status = 'pending'`;
    return rows.map((r) => this.map(r));
  }
}
