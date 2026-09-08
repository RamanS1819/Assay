import { describe, it, expect, vi } from 'vitest';
import { runCycle, SimpleBudget, type LoopOps, type Subject } from './loop';
import type { Score, UnderwritingDecision } from '../types/index';

function score(): Score {
  return {
    address: '0xa', chain: 'ethereum', value: 70,
    subscores: { accountMaturity: 0, portfolioQuality: 0, leverageHistory: 0, counterpartyHygiene: 0, recentVolatility: 0 },
    weights: { accountMaturity: 0.15, portfolioQuality: 0.25, leverageHistory: 0.3, counterpartyHygiene: 0.2, recentVolatility: 0.1 },
    asOfBlock: 500, computedAt: 'T', inputs: [], modelVersion: '1.0.0',
  };
}
function decision(over: Partial<UnderwritingDecision> = {}): UnderwritingDecision {
  return { subject: '0xa', limit: 5000, rationale: 'r', scoreRef: { address: '0xa', asOfBlock: 1, value: 70 }, revokes: false, escalated: false, ...over };
}

function ops(over: Partial<LoopOps> = {}): LoopOps {
  return {
    peekScore: vi.fn(() => null),
    buyScore: vi.fn(async () => ({ score: score() })),
    underwrite: vi.fn(async () => decision()),
    execute: vi.fn(async () => '0xtx'),
    enqueueApproval: vi.fn(async () => {}),
    audit: vi.fn(async () => {}),
    ...over,
  };
}
const subj = (address: string, exposureUnits = 0): Subject => ({ address, exposureUnits, requestedUnits: 5000 });
const cfg = (budgetUsd: number) => ({ price: 0.002, budget: new SimpleBudget(budgetUsd) });

describe('runCycle', () => {
  it('skips when the budget cannot cover another query', async () => {
    const o = ops();
    const r = await runCycle([subj('0xa')], 1000, o, cfg(0));
    expect(r.skipped).toEqual([{ subject: '0xa', reason: 'budget_exhausted' }]);
    expect(o.buyScore).not.toHaveBeenCalled();
  });

  it('skips a fresh score without buying', async () => {
    const o = ops({ peekScore: vi.fn(() => ({ asOfBlock: 999 })) }); // 1 block old
    const r = await runCycle([subj('0xa', 10)], 1000, o, cfg(5));
    expect(r.skipped[0].reason).toBe('fresh');
    expect(o.buyScore).not.toHaveBeenCalled();
  });

  it('buys, underwrites, and executes an under-threshold decision', async () => {
    const c = cfg(5);
    const o = ops();
    const r = await runCycle([subj('0xa')], 1000, o, c);
    expect(r.issued).toEqual(['0xa']);
    expect(r.scored).toEqual(['0xa']);
    expect(o.execute).toHaveBeenCalledOnce();
    expect(o.enqueueApproval).not.toHaveBeenCalled();
    expect(c.budget.remainingToday()).toBeCloseTo(5 - 0.002, 6);
  });

  it('escalates instead of executing when the decision is escalated', async () => {
    const o = ops({ underwrite: vi.fn(async () => decision({ limit: 50000, escalated: true })) });
    const r = await runCycle([subj('0xa')], 1000, o, cfg(5));
    expect(r.escalated).toEqual(['0xa']);
    expect(o.enqueueApproval).toHaveBeenCalledOnce();
    expect(o.execute).not.toHaveBeenCalled();
  });

  it('runs the budget down across subjects — later ones skip when exhausted', async () => {
    const o = ops();
    const r = await runCycle([subj('0xa'), subj('0xb')], 1000, o, cfg(0.002)); // covers exactly one
    expect(r.issued).toEqual(['0xa']);
    expect(r.skipped).toEqual([{ subject: '0xb', reason: 'budget_exhausted' }]);
    expect(o.buyScore).toHaveBeenCalledOnce();
  });
});
