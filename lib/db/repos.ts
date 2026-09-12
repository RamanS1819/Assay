/**
 * Write-side repositories the loop and gateway use to feed the console:
 *   - AuditRepo     every event worth showing (append-only)
 *   - ScoresRepo    score history for the holder register
 *   - PaymentsRepo  x402 receipts with their Hedera tx hash
 *   - DecisionsRepo underwriting outcomes (limit, rationale, state)
 *   - HoldersRepo   the current holder register (upserted each decision)
 *
 * The `sql` client is injected; value mapping is unit-tested with a mock.
 */
import type { Score, UnderwritingDecision, AuditEvent } from '../types/index';
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

/** issued = line granted, revoked = existing line pulled, denied = new applicant
 *  refused (below floor, no prior line), escalated = withheld for 2-of-3 quorum. */
export type DecisionState = 'issued' | 'escalated' | 'revoked' | 'denied';

export class DecisionsRepo {
  constructor(private sql: Sql) {}
  async record(d: UnderwritingDecision, state: DecisionState): Promise<void> {
    await this.sql`
      INSERT INTO decisions (subject, limit_units, rationale, as_of_block, score_value, state, escalated)
      VALUES (${d.subject}, ${d.limit}, ${d.rationale}, ${d.scoreRef.asOfBlock}, ${d.scoreRef.value}, ${state}, ${d.escalated})`;
  }
}

export interface HolderState {
  address: string;
  units: number;
  eligible: boolean;
  limit: number;
}

export class HoldersRepo {
  constructor(private sql: Sql) {}
  async upsert(h: HolderState): Promise<void> {
    await this.sql`
      INSERT INTO holders (address, units, eligibility, limit_units)
      VALUES (${h.address}, ${h.units}, ${h.eligible}, ${h.limit})
      ON CONFLICT (address) DO UPDATE
        SET units = ${h.units}, eligibility = ${h.eligible}, limit_units = ${h.limit}`;
  }
}
