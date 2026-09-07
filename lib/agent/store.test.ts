import { describe, it, expect } from 'vitest';
import { InMemoryCursorStore, InMemoryIntentStore } from './store';

describe('InMemoryCursorStore', () => {
  it('defaults to 0 and persists writes', async () => {
    const c = new InMemoryCursorStore();
    expect(await c.get()).toBe(0);
    await c.set(1234);
    expect(await c.get()).toBe(1234);
  });
});

describe('InMemoryIntentStore', () => {
  it('creates pending intents and lists them', async () => {
    const s = new InMemoryIntentStore(() => 42);
    const i = await s.create('k1');
    expect(i).toEqual({ key: 'k1', status: 'pending', createdAt: 42 });
    expect(await s.listPending()).toHaveLength(1);
  });

  it('marks an intent settled and drops it from the pending list', async () => {
    const s = new InMemoryIntentStore();
    await s.create('k1');
    await s.markSettled('k1', '0xabc');
    const i = await s.find('k1');
    expect(i?.status).toBe('settled');
    expect(i?.txHash).toBe('0xabc');
    expect(await s.listPending()).toHaveLength(0);
  });

  it('returns undefined for an unknown key', async () => {
    expect(await new InMemoryIntentStore().find('nope')).toBeUndefined();
  });
});
