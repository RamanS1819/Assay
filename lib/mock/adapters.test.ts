import { describe, it, expect } from 'vitest';
import { mockScoreDeps, MockFacilitator, MockExecutor, fakeTxHash } from './adapters';
import { InMemoryControlList } from './control-list';
import { demoChain, ADDR } from './fixtures';
import { getScore } from '../scorer/getScore';

describe('mockScoreDeps', () => {
  it('feeds getScore from the fixture chain', async () => {
    const chain = demoChain();
    const score = await getScore(ADDR.whale, { atBlock: chain.headBlock(), chain: 'ethereum' }, mockScoreDeps(chain));
    expect(score.address).toBe(ADDR.whale);
    expect(score.value).toBeGreaterThan(0);
    expect(score.inputs).toContain('messari-lending');
  });
});

describe('MockFacilitator', () => {
  it('accepts and settles', async () => {
    const f = new MockFacilitator();
    expect(await f.verify()).toEqual({ isValid: true });
    expect((await f.settle()).txHash).toMatch(/^0xpay/);
  });
});

describe('MockExecutor', () => {
  it('applies an issue to the control-list', async () => {
    const cl = new InMemoryControlList('0xAgent');
    const tx = await new MockExecutor(cl).execute({ kind: 'issue', subject: ADDR.fresh, units: 5000 });
    expect(tx).toMatch(/^0xexec/);
    expect(cl.isEligible(ADDR.fresh)).toBe(true);
    expect(cl.balanceOf(ADDR.fresh)).toBe(5000n);
  });

  it('applies a revoke to the control-list', async () => {
    const cl = new InMemoryControlList('0xAgent');
    cl.issue('0xAgent', ADDR.distressed, 1000n);
    await new MockExecutor(cl).execute({ kind: 'revoke', subject: ADDR.distressed });
    expect(cl.isEligible(ADDR.distressed)).toBe(false);
  });
});

describe('fakeTxHash', () => {
  it('produces unique prefixed hashes', () => {
    expect(fakeTxHash('0xa')).not.toBe(fakeTxHash('0xa'));
  });
});
