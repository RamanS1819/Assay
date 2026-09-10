import { describe, it, expect } from 'vitest';
import { runDemo } from './demo';
import { ADDR } from './fixtures';

describe('runDemo (end-to-end, offline)', () => {
  it('runs all five beats: issue, escalate+approve, liquidate+revoke+revert', async () => {
    const r = await runDemo();

    // Beat 1-3: autonomous issuance
    expect(r.whaleIssued).toBe(true);
    expect(r.distressedIssuedUnits).toBeGreaterThan(0n);

    // Beat 4: large request escalates, then approves + executes
    expect(r.escalated).toContain(ADDR.fresh);
    expect(r.approvedThenExecuted).toContain(ADDR.fresh);
    expect(r.controlList.isEligible(ADDR.fresh)).toBe(true);

    // Beat 5: liquidation -> revoke -> transfer reverts
    expect(r.distressedRevoked).toBe(true);
    expect(r.revertMessage).toMatch(/FromNotEligible/);
  });

  it('produces an audit trail with payments, scores, and executions', async () => {
    const { audit } = await runDemo();
    const types = new Set(audit.map((e) => e.type));
    expect(types.has('payment')).toBe(true);
    expect(types.has('score')).toBe(true);
    expect(types.has('execution')).toBe(true);
    // every payment carries a tx hash (the HashScan receipt in the real flow)
    for (const e of audit) if (e.type === 'payment') expect(e.txHash).toBeTruthy();
  });
});
