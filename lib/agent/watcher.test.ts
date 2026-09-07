import { describe, it, expect, vi } from 'vitest';
import { pollLiquidations, DEFAULT_CONFIRMATION_LAG, type WatcherDeps } from './watcher';
import { InMemoryCursorStore } from './store';
import type { LiquidationEvent } from '../scorer/sources';

function deps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
  return {
    headBlock: vi.fn(async () => 1000),
    fetchLiquidations: vi.fn(async () => [] as LiquidationEvent[]),
    cursor: new InMemoryCursorStore(0),
    ...overrides,
  };
}

describe('pollLiquidations', () => {
  it('queries from cursor+1 to head-lag and advances the cursor', async () => {
    const cursor = new InMemoryCursorStore(0);
    const fetchLiquidations = vi.fn(async () => [
      { liquidatee: '0xAAA', blockNumber: 10 },
      { liquidatee: '0xBBB', blockNumber: 20 },
    ]);
    const d = deps({ cursor, fetchLiquidations, headBlock: vi.fn(async () => 1000) });

    const r = await pollLiquidations(d);

    expect(fetchLiquidations).toHaveBeenCalledWith(1, 1000 - DEFAULT_CONFIRMATION_LAG);
    expect(r.affected).toEqual(['0xaaa', '0xbbb']); // lowercased + unique
    expect(await cursor.get()).toBe(1000 - DEFAULT_CONFIRMATION_LAG);
    expect(r.advanced).toBe(true);
  });

  it('dedupes repeated liquidatees in the same batch', async () => {
    const fetchLiquidations = vi.fn(async () => [
      { liquidatee: '0xAAA', blockNumber: 10 },
      { liquidatee: '0xaaa', blockNumber: 15 },
    ]);
    const r = await pollLiquidations(deps({ fetchLiquidations }));
    expect(r.affected).toEqual(['0xaaa']);
  });

  it('does nothing when head has not advanced past the lag window', async () => {
    const cursor = new InMemoryCursorStore(995);
    const fetchLiquidations = vi.fn();
    const d = deps({ cursor, fetchLiquidations, headBlock: vi.fn(async () => 998) }); // toBlock=993 < from=996

    const r = await pollLiquidations(d);

    expect(fetchLiquidations).not.toHaveBeenCalled();
    expect(r.advanced).toBe(false);
    expect(await cursor.get()).toBe(995); // unchanged
  });

  it('resumes from the persisted cursor on restart — no skip, no reprocess', async () => {
    const cursor = new InMemoryCursorStore(0);
    const fetchLiquidations = vi.fn(async () => []);
    let headVal = 500;
    const head = vi.fn(async () => headVal);

    await pollLiquidations(deps({ cursor, fetchLiquidations, headBlock: head }));
    expect(fetchLiquidations).toHaveBeenNthCalledWith(1, 1, 495); // 1..495
    expect(await cursor.get()).toBe(495);

    headVal = 600; // chain advanced; "restart" = new watcher, same cursor store
    await pollLiquidations(deps({ cursor, fetchLiquidations, headBlock: head }));
    expect(fetchLiquidations).toHaveBeenNthCalledWith(2, 496, 595); // resumes at 496 — no overlap, no gap
    expect(await cursor.get()).toBe(595);
  });

  it('does NOT advance the cursor if the fetch fails (range is retried)', async () => {
    const cursor = new InMemoryCursorStore(0);
    const fetchLiquidations = vi.fn(async () => {
      throw new Error('graph timeout');
    });
    const d = deps({ cursor, fetchLiquidations });

    await expect(pollLiquidations(d)).rejects.toThrow('graph timeout');
    expect(await cursor.get()).toBe(0); // unchanged -> same range retried next poll
  });
});
