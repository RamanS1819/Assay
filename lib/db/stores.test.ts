import { describe, it, expect, vi } from 'vitest';
import { DbCursorStore, DbIntentStore, type Sql } from './stores';

/** A mock neon client that returns queued row-sets in order. */
function mockSql(responses: Record<string, unknown>[][]) {
  let i = 0;
  const fn = vi.fn(async () => responses[i++] ?? []);
  return { sql: fn as unknown as Sql, fn };
}

describe('DbCursorStore', () => {
  it('reads the stored block, defaulting to 0 when the row is absent', async () => {
    const withRow = mockSql([[{ block: 4200 }]]);
    expect(await new DbCursorStore(withRow.sql).get()).toBe(4200);

    const empty = mockSql([[]]);
    expect(await new DbCursorStore(empty.sql).get()).toBe(0);
  });

  it('issues an upsert on set', async () => {
    const m = mockSql([[]]);
    await new DbCursorStore(m.sql).set(999);
    expect(m.fn).toHaveBeenCalledOnce();
  });
});

describe('DbIntentStore', () => {
  it('maps a row into a PaymentIntent (tx_hash null -> undefined)', async () => {
    const m = mockSql([[{ key: 'k1', status: 'pending', tx_hash: null, created_at: '2026-09-06T00:00:00.000Z' }]]);
    const intent = await new DbIntentStore(m.sql).find('k1');
    expect(intent).toEqual({ key: 'k1', status: 'pending', txHash: undefined, createdAt: Date.parse('2026-09-06T00:00:00.000Z') });
  });

  it('returns undefined when the key is not found', async () => {
    const m = mockSql([[]]);
    expect(await new DbIntentStore(m.sql).find('nope')).toBeUndefined();
  });

  it('maps the RETURNING row from create', async () => {
    const m = mockSql([[{ key: 'k2', status: 'pending', tx_hash: null, created_at: '2026-09-06T00:00:00.000Z' }]]);
    const intent = await new DbIntentStore(m.sql).create('k2');
    expect(intent.key).toBe('k2');
    expect(intent.status).toBe('pending');
  });

  it('maps a settled row and lists pending', async () => {
    const m = mockSql([[
      { key: 'a', status: 'pending', tx_hash: null, created_at: '2026-09-06T00:00:00.000Z' },
      { key: 'b', status: 'pending', tx_hash: null, created_at: '2026-09-06T00:00:00.000Z' },
    ]]);
    const pending = await new DbIntentStore(m.sql).listPending();
    expect(pending.map((p) => p.key)).toEqual(['a', 'b']);
  });
});
