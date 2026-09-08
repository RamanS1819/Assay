/**
 * Write-side repositories the loop and gateway use to feed the console:
 *   - AuditRepo    every event worth showing (append-only)
 *   - ScoresRepo   score history for the holder register
 *   - PaymentsRepo x402 receipts with their Hedera tx hash
 *
 * The `sql` client is injected; value mapping is unit-tested with a mock.
 */
import type { Score, AuditEvent } from '../types/index';
import type { Sql } from './stores';

export class AuditRepo {
  constructor(private sql: Sql) {}
  async append(event: AuditEvent): Promise<void> {
    const txHash = 'txHash' in event ? event.txHash : null;
    await this.sql`INSERT INTO audit (type, payload, tx_hash) VALUES (${event.type}, ${JSON.stringify(event)}, ${txHash})`;
  }
}

export class ScoresRepo {
  constructor(private sql: Sql) {}
  async save(s: Score): Promise<void> {
    await this.sql`
      INSERT INTO scores (address, chain, value, subscores, as_of_block, model_version)
      VALUES (${s.address}, ${s.chain}, ${s.value}, ${JSON.stringify(s.subscores)}, ${s.asOfBlock}, ${s.modelVersion})
      ON CONFLICT (address, as_of_block) DO NOTHING`;
  }
}

export interface PaymentReceipt {
  txHash: string;
  amount: string;
  route: string;
  subject: string;
}

export class PaymentsRepo {
  constructor(private sql: Sql) {}
  async save(p: PaymentReceipt): Promise<void> {
    await this.sql`
      INSERT INTO payments (tx_hash, amount, route, subject_address)
      VALUES (${p.txHash}, ${p.amount}, ${p.route}, ${p.subject})
      ON CONFLICT (tx_hash) DO NOTHING`;
  }
}
