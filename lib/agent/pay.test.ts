import { describe, it, expect, vi } from 'vitest';
import { payForScore, reconcilePending, paymentKey, type PayDeps } from './pay';
import { InMemoryIntentStore } from './store';

describe('paymentKey', () => {
  it('ties a purchase to (subject, block bucket) and is stable within a window', () => {
    expect(paymentKey('0xAbC', 1000)).toBe(paymentKey('0xabc', 1100));
    expect(paymentKey('0xabc', 1000)).not.toBe(paymentKey('0xabc', 5000));
  });
});

describe('payForScore', () => {
  it('records intent, settles once, and marks it settled', async () => {
    const intents = new InMemoryIntentStore();
    const settle = vi.fn(async () => '0xhash1');
    const r = await payForScore('0xabc', 'k1', { intents, settle });

    expect(r).toEqual({ txHash: '0xhash1', alreadySettled: false });
    expect(settle).toHaveBeenCalledOnce();
    expect((await intents.find('k1'))?.status).toBe('settled');
  });

  it('never pays twice for a settled key (crash-after-settle + dedup safety)', async () => {
    const intents = new InMemoryIntentStore();
    const settle = vi.fn(async () => '0xhash1');

    await payForScore('0xabc', 'k1', { intents, settle });
    const second = await payForScore('0xabc', 'k1', { intents, settle });

    expect(second).toEqual({ txHash: '0xhash1', alreadySettled: true });
    expect(settle).toHaveBeenCalledOnce(); // NOT called again
  });
});

describe('reconcilePending', () => {
  it('marks pending intents that actually settled on-chain, leaves the rest', async () => {
    const intents = new InMemoryIntentStore();
    await intents.create('paid'); // crashed after paying, before markSettled
    await intents.create('unpaid'); // never actually paid

    const reconcile = vi.fn(async (key: string) => (key === 'paid' ? '0xrecovered' : null));
    const fixed = await reconcilePending({ intents, reconcile });

    expect(fixed).toBe(1);
    expect((await intents.find('paid'))?.status).toBe('settled');
    expect((await intents.find('paid'))?.txHash).toBe('0xrecovered');
    expect((await intents.find('unpaid'))?.status).toBe('pending');
  });

  it('after reconciliation, payForScore returns the recovered tx without re-paying', async () => {
    const intents = new InMemoryIntentStore();
    await intents.create('k1'); // in-flight from a prior run
    await reconcilePending({ intents, reconcile: async () => '0xrecovered' });

    const settle = vi.fn(async () => '0xNEW');
    const r = await payForScore('0xabc', 'k1', { intents, settle });

    expect(r).toEqual({ txHash: '0xrecovered', alreadySettled: true });
    expect(settle).not.toHaveBeenCalled();
  });
});
