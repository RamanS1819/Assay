import { describe, it, expect, vi } from 'vitest';
import { decisionToAction, applyDecision, type Executor } from './executor';
import type { UnderwritingDecision, AuditEvent } from '../types/index';

function decision(over: Partial<UnderwritingDecision> = {}): UnderwritingDecision {
  return { subject: '0xabc', limit: 5000, rationale: 'r', scoreRef: { address: '0xabc', asOfBlock: 1, value: 70 }, revokes: false, escalated: false, ...over };
}

describe('decisionToAction', () => {
  it('maps a revocation to revoke, otherwise to issue with units', () => {
    expect(decisionToAction(decision({ revokes: true }))).toEqual({ kind: 'revoke', subject: '0xabc' });
    expect(decisionToAction(decision({ limit: 3000 }))).toEqual({ kind: 'issue', subject: '0xabc', units: 3000 });
  });
});

describe('applyDecision', () => {
  it('executes the action and records an execution audit event', async () => {
    const executor: Executor = { execute: vi.fn(async () => '0xtx') };
    const events: AuditEvent[] = [];
    const tx = await applyDecision(decision({ limit: 3000 }), {
      executor,
      audit: async (e) => { events.push(e); },
      now: () => 'T',
    });
    expect(tx).toBe('0xtx');
    expect(executor.execute).toHaveBeenCalledWith({ kind: 'issue', subject: '0xabc', units: 3000 });
    expect(events).toEqual([{ type: 'execution', txHash: '0xtx', action: 'issue', subject: '0xabc', at: 'T' }]);
  });

  it('records a revoke execution', async () => {
    const executor: Executor = { execute: vi.fn(async () => '0xrevoke') };
    const events: AuditEvent[] = [];
    await applyDecision(decision({ revokes: true, limit: 0 }), { executor, audit: async (e) => { events.push(e); }, now: () => 'T' });
    expect(events[0]).toMatchObject({ type: 'execution', action: 'revoke', txHash: '0xrevoke' });
  });
});
