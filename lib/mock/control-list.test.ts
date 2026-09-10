import { describe, it, expect } from 'vitest';
import { InMemoryControlList, ControlListError } from './control-list';

const AGENT = '0xAgent';
const A = '0xHolderA';
const B = '0xHolderB';
const OUT = '0xOutsider';

describe('InMemoryControlList (parity with CreditToken.sol)', () => {
  it('issues a credit line and marks the holder eligible', () => {
    const cl = new InMemoryControlList(AGENT);
    cl.issue(AGENT, A, 1000n);
    expect(cl.balanceOf(A)).toBe(1000n);
    expect(cl.isEligible(A)).toBe(true);
  });

  it('allows a transfer between two eligible holders', () => {
    const cl = new InMemoryControlList(AGENT);
    cl.issue(AGENT, A, 1000n);
    cl.setEligible(AGENT, B, true);
    expect(() => cl.transfer(A, B, 100n)).not.toThrow();
    expect(cl.balanceOf(B)).toBe(100n);
    expect(cl.balanceOf(A)).toBe(900n);
  });

  it('REVERTS a revoked holder\'s transfer — beat 5', () => {
    const cl = new InMemoryControlList(AGENT);
    cl.issue(AGENT, A, 1000n);
    cl.setEligible(AGENT, B, true);
    cl.revoke(AGENT, A);
    expect(() => cl.transfer(A, B, 100n)).toThrow(ControlListError);
    try {
      cl.transfer(A, B, 100n);
    } catch (e) {
      expect((e as ControlListError).code).toBe('FromNotEligible');
    }
  });

  it('reverts a transfer to a non-eligible recipient', () => {
    const cl = new InMemoryControlList(AGENT);
    cl.issue(AGENT, A, 1000n);
    expect(() => cl.transfer(A, OUT, 100n)).toThrow(/ToNotEligible/);
  });

  it('blocks non-agents from issuing or revoking', () => {
    const cl = new InMemoryControlList(AGENT);
    expect(() => cl.issue(OUT, A, 1n)).toThrow(/NotAgent/);
    expect(() => cl.revoke(OUT, A)).toThrow(/NotAgent/);
  });

  it('normalizes address case', () => {
    const cl = new InMemoryControlList(AGENT);
    cl.issue(AGENT, '0xABCdef', 5n);
    expect(cl.balanceOf('0xabcDEF')).toBe(5n);
    expect(cl.isEligible('0xABCDEF')).toBe(true);
  });
});
