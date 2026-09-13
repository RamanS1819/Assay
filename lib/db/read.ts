/**
 * Read-model for the console. One place that turns DB rows into the shapes the UI
 * renders: the holder register, today's agent spend, the audit trail, and recent
 * underwriting decisions. sql is injected, so the mapping is unit-tested with a mock.
 */
import type { Sql } from './stores';

export interface Holder {
  address: string;
  units: number;
  eligible: boolean;
  limit: number;
  lastScoreId: number | null;
}

export interface SpendSummary {
  /** Total settled today, in the asset's base units. */
  spentBaseUnits: number;
  count: number;
}

export interface AuditRow {
  type: string;
  payload: unknown;
  txHash: string | null;
  at: string;
}

export interface DecisionRow {
  subject: string;
  limit: number;
  rationale: string;
  state: string;
  escalated: boolean;
  at: string;
}

export interface ConsoleState {
  holders: Holder[];
  spend: SpendSummary;
  audit: AuditRow[];
  decisions: DecisionRow[];
}

export async function getHolders(sql: Sql): Promise<Holder[]> {
  const rows = await sql<Record<string, unknown>>`
    SELECT address, units, eligibility, limit_units, last_score_id
    FROM holders ORDER BY units DESC`;
  return rows.map((r) => ({
    address: String(r.address),
    units: Number(r.units ?? 0),
    eligible: Boolean(r.eligibility),
    limit: Number(r.limit_units ?? 0),
    lastScoreId: r.last_score_id == null ? null : Number(r.last_score_id),
  }));
}

export async function getSpendSummary(sql: Sql): Promise<SpendSummary> {
  // All-time spend: every settled query counts, so the meter reads true even when a
  // recording happens the day after the data was populated.
  const rows = await sql<Record<string, unknown>>`
    SELECT COALESCE(SUM(CAST(amount AS numeric)), 0) AS spent, COUNT(*) AS count
    FROM payments`;
  const r = rows[0] ?? {};
  return { spentBaseUnits: Number(r.spent ?? 0), count: Number(r.count ?? 0) };
}

export async function getRecentAudit(sql: Sql, limit = 50): Promise<AuditRow[]> {
  const rows = await sql<Record<string, unknown>>`
    SELECT type, payload, tx_hash, created_at
    FROM audit ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    type: String(r.type),
    payload: r.payload,
    txHash: (r.tx_hash as string | null) ?? null,
    at: String(r.created_at),
  }));
}

export async function getRecentDecisions(sql: Sql, limit = 20): Promise<DecisionRow[]> {
  const rows = await sql<Record<string, unknown>>`
    SELECT subject, limit_units, rationale, state, escalated, created_at
    FROM decisions ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    subject: String(r.subject),
    limit: Number(r.limit_units ?? 0),
    rationale: String(r.rationale ?? ''),
    state: String(r.state),
    escalated: Boolean(r.escalated),
    at: String(r.created_at),
  }));
}

export async function getConsoleState(sql: Sql): Promise<ConsoleState> {
  const [holders, spend, audit, decisions] = await Promise.all([
    getHolders(sql),
    getSpendSummary(sql),
    getRecentAudit(sql),
    getRecentDecisions(sql),
  ]);
  return { holders, spend, audit, decisions };
}
