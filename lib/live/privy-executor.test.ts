import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { encodeAction, CREDIT_TOKEN_ABI } from './privy-executor';

const iface = new ethers.Interface([...CREDIT_TOKEN_ABI]);
const SUBJECT = '0x1111111111111111111111111111111111111111';

describe('encodeAction', () => {
  it('encodes an issue call with the subject and amount', () => {
    const data = encodeAction({ kind: 'issue', subject: SUBJECT, units: 5000 }, iface);
    expect(data).toBe(iface.encodeFunctionData('issue', [SUBJECT, 5000n]));
    // decodes back to the same args
    const decoded = iface.decodeFunctionData('issue', data);
    expect(decoded[0].toLowerCase()).toBe(SUBJECT);
    expect(decoded[1]).toBe(5000n);
  });

  it('rounds a fractional unit amount', () => {
    const data = encodeAction({ kind: 'issue', subject: SUBJECT, units: 4999.6 }, iface);
    expect(iface.decodeFunctionData('issue', data)[1]).toBe(5000n);
  });

  it('encodes a revoke call with just the subject', () => {
    const data = encodeAction({ kind: 'revoke', subject: SUBJECT }, iface);
    expect(data).toBe(iface.encodeFunctionData('revoke', [SUBJECT]));
    expect(data.startsWith(iface.getFunction('revoke')!.selector)).toBe(true);
  });

  it('produces different selectors for issue vs revoke', () => {
    const issue = encodeAction({ kind: 'issue', subject: SUBJECT, units: 1 }, iface);
    const revoke = encodeAction({ kind: 'revoke', subject: SUBJECT }, iface);
    expect(issue.slice(0, 10)).not.toBe(revoke.slice(0, 10));
  });
});
