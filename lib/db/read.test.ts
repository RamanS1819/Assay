import { describe, it, expect, vi } from 'vitest';
import { getHolders, getSpendSummary, getRecentAudit, getRecentDecisions, getConsoleState } from './read';
import type { Sql } from './stores';

/** Mock neon client returning queued row-sets in order. */
function mockSql(responses: Record<string, unknown>[][]) {
  let i = 0;
  return vi.fn(async () => responses[i++] ?? []) as unknown as Sql;
}

describe('getHolders', () => {
  it('maps rows and coerces types', async () => {
    const sql = mockSql([[{ address: '0xA', units: '5000', eligibility: true, limit_units: '10000', last_score_id: '7' }]]);
    expect(await getHolders(sql)).toEqual([
      { address: '0xA', units: 5000, eligible: true, limit: 10000, lastScoreId: 7 },
    ]);
  });
  it('handles a null last_score_id', async () => {
    const sql = mockSql([[{ address: '0xB', units: 0, eligibility: false, limit_units: 0, last_score_id: null }]]);
    expect((await getHolders(sql))[0].lastScoreId).toBeNull();
  });
});

describe('getSpendSummary', () => {
  it('returns the summed base units and count', async () => {
    const sql = mockSql([[{ spent: '2500', count: '3' }]]);
    expect(await getSpendSummary(sql)).toEqual({ spentBaseUnits: 2500, count: 3 });
  });
  it('defaults to zero with no payments', async () => {
    expect(await getSpendSummary(mockSql([[]]))).toEqual({ spentBaseUnits: 0, count: 0 });
  });
});

describe('getRecentAudit', () => {
  it('maps audit rows including null tx hash', async () => {
    const sql = mockSql([[{ type: 'skip', payload: { reason: 'fresh' }, tx_hash: null, created_at: 'T' }]]);
    expect(await getRecentAudit(sql)).toEqual([{ type: 'skip', payload: { reason: 'fresh' }, txHash: null, at: 'T' }]);
  });
});

describe('getRecentDecisions', () => {
  it('maps decision rows', async () => {
    const sql = mockSql([[{ subject: '0xA', limit_units: '5000', rationale: 'ok', state: 'issued', escalated: false, created_at: 'T' }]]);
    expect(await getRecentDecisions(sql)).toEqual([
      { subject: '0xA', limit: 5000, rationale: 'ok', state: 'issued', escalated: false, at: 'T' },
    ]);
  });
});

describe('getConsoleState', () => {
  it('composes all four sections', async () => {
    const sql = mockSql([
      [{ address: '0xA', units: 1, eligibility: true, limit_units: 1, last_score_id: 1 }], // holders
      [{ spent: '10', count: '1' }], // spend
      [{ type: 'score', payload: {}, tx_hash: null, created_at: 'T' }], // audit
      [{ subject: '0xA', limit_units: 1, rationale: 'r', state: 'issued', escalated: false, created_at: 'T' }], // decisions
    ]);
    const state = await getConsoleState(sql);
    expect(state.holders).toHaveLength(1);
    expect(state.spend.count).toBe(1);
    expect(state.audit).toHaveLength(1);
    expect(state.decisions).toHaveLength(1);
  });
});
