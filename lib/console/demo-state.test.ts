import { describe, it, expect } from 'vitest';
import { demoConsoleState } from './demo-state';

describe('demoConsoleState', () => {
  it('populates all four console sections', () => {
    const s = demoConsoleState();
    expect(s.holders.length).toBeGreaterThan(0);
    expect(s.decisions.length).toBeGreaterThan(0);
    expect(s.audit.length).toBeGreaterThan(0);
    expect(s.spend.count).toBe(2);
  });

  it('tells the beat-4 (escalation) and beat-5 (revoke) story', () => {
    const s = demoConsoleState();
    expect(s.decisions.some((d) => d.escalated)).toBe(true);
    expect(s.decisions.some((d) => d.state === 'revoked')).toBe(true);
    expect(s.audit.some((a) => a.type === 'execution' && (a.payload as { action?: string }).action === 'revoke')).toBe(true);
  });

  it('returns audit newest-first (matching the read-model order)', () => {
    const audit = demoConsoleState().audit;
    const times = audit.map((a) => a.at);
    const sorted = [...times].sort().reverse();
    expect(times).toEqual(sorted);
  });
});
