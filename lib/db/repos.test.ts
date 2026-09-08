import { describe, it, expect, vi } from 'vitest';
import { AuditRepo, ScoresRepo, PaymentsRepo } from './repos';
import type { Sql } from './stores';
import type { Score, AuditEvent } from '../types/index';

/** Mock neon client; a tagged call sql`...${a}${b}` invokes fn(strings, a, b). */
function mockSql() {
  const fn = vi.fn(async () => []);
  return { sql: fn as unknown as Sql, values: () => fn.mock.calls[0].slice(1) };
}

describe('AuditRepo', () => {
  it('extracts the tx hash from an event that has one', async () => {
    const m = mockSql();
    const event: AuditEvent = { type: 'payment', txHash: '0xabc', amountUsd: 0.002, route: '/score', subject: '0x1', at: 'T' };
    await new AuditRepo(m.sql).append(event);
    const [type, payload, txHash] = m.values();
    expect(type).toBe('payment');
    expect(txHash).toBe('0xabc');
    expect(JSON.parse(payload as string)).toMatchObject({ type: 'payment', subject: '0x1' });
  });

  it('stores null tx hash for an event without one', async () => {
    const m = mockSql();
    await new AuditRepo(m.sql).append({ type: 'skip', subject: '0x1', reason: 'fresh', at: 'T' });
    expect(m.values()[2]).toBeNull();
  });
});

describe('ScoresRepo', () => {
  it('serializes subscores and keys by address + block', async () => {
    const m = mockSql();
    const s: Score = {
      address: '0xabc', chain: 'ethereum', value: 72,
      subscores: { accountMaturity: 60, portfolioQuality: 55, leverageHistory: 80, counterpartyHygiene: 90, recentVolatility: 70 },
      weights: { accountMaturity: 0.15, portfolioQuality: 0.25, leverageHistory: 0.3, counterpartyHygiene: 0.2, recentVolatility: 0.1 },
      asOfBlock: 500, computedAt: 'T', inputs: [], modelVersion: '1.0.0',
    };
    await new ScoresRepo(m.sql).save(s);
    const [address, chain, value, subscores, asOfBlock] = m.values();
    expect([address, chain, value, asOfBlock]).toEqual(['0xabc', 'ethereum', 72, 500]);
    expect(JSON.parse(subscores as string).leverageHistory).toBe(80);
  });
});

describe('PaymentsRepo', () => {
  it('saves a receipt with its Hedera tx hash', async () => {
    const m = mockSql();
    await new PaymentsRepo(m.sql).save({ txHash: '0xtx', amount: '2000', route: '/score', subject: '0x1' });
    expect(m.values()).toEqual(['0xtx', '2000', '/score', '0x1']);
  });
});
