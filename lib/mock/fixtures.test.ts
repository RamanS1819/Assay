import { describe, it, expect } from 'vitest';
import { demoChain, ADDR } from './fixtures';
import { toScoreInputs } from '../scorer/map';
import { computeScore } from '../scorer/model';

function scoreOf(chain: ReturnType<typeof demoChain>, address: string): number {
  const inputs = toScoreInputs({ lending: chain.lending(address), portfolio: chain.portfolio(address) });
  return computeScore(inputs, { address, chain: 'ethereum', asOfBlock: chain.headBlock(), inputs: [] }).value;
}

describe('demoChain fixtures', () => {
  it('scores the clean whale above the fresh applicant', () => {
    const chain = demoChain();
    expect(scoreOf(chain, ADDR.whale)).toBeGreaterThan(scoreOf(chain, ADDR.fresh));
  });

  it('drops the distressed wallet\'s score below the maintenance floor after a liquidation (beat 5 trigger)', () => {
    const chain = demoChain();
    const before = scoreOf(chain, ADDR.distressed);
    chain.liquidate(ADDR.distressed);
    const after = scoreOf(chain, ADDR.distressed);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(50); // below MAINTENANCE_FLOOR -> triggers revoke
  });

  it('surfaces the liquidation event in the global query window', () => {
    const chain = demoChain();
    chain.advance(100);
    chain.liquidate(ADDR.distressed);
    const events = chain.liquidationsSince(0, chain.headBlock());
    expect(events).toHaveLength(1);
    expect(events[0].liquidatee).toBe(ADDR.distressed.toLowerCase());
  });

  it('returns empty history for an unseeded address', () => {
    const chain = demoChain();
    expect(chain.lending('0x9999999999999999999999999999999999999999').liquidationCount).toBe(0);
    expect(chain.portfolio('0x9999999999999999999999999999999999999999')).toEqual([]);
  });
});
