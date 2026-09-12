/**
 * Mock implementations of the injected interfaces, backed by MockChain + the
 * in-process control-list. These are drop-in for the live clients (same types),
 * so the whole system runs end-to-end with no keys. Swap these for the real Privy
 * / Blocky402 / Graph clients when .env is filled — nothing else changes.
 */
import type { ScoreDeps } from '../scorer/getScore';
import { InMemoryScoreCache } from '../scorer/cache';
import type { FacilitatorClient } from '../gateway/x402';
import type { Executor, ControlAction } from '../agent/executor';
import { InMemoryControlList } from './control-list';
import type { MockChain } from './fixtures';

let counter = 0;
export function fakeTxHash(prefix = '0xmock'): string {
  return `${prefix}${(++counter).toString(16).padStart(6, '0')}`;
}

/** Score data from the fixture chain instead of The Graph. Models a fully-wired
 *  scorer: it supplies counterparty data (observed, clean) so the demo doesn't lean
 *  on the missing-data neutral default the live (lending-only) scorer falls back to. */
export function mockScoreDeps(chain: MockChain, cache: InMemoryScoreCache = new InMemoryScoreCache()): ScoreDeps {
  return {
    fetchLending: async (address) => chain.lending(address),
    fetchPortfolio: async (address) => chain.portfolio(address),
    fetchCounterparty: async () => ({ flaggedInteractionCount: 0, totalCounterparties: 20 }),
    cache,
  };
}

/** x402 facilitator that always accepts and returns a fake settled tx hash. */
export class MockFacilitator implements FacilitatorClient {
  async verify(): Promise<{ isValid: boolean }> {
    return { isValid: true };
  }
  async settle(): Promise<{ txHash: string }> {
    return { txHash: fakeTxHash('0xpay') };
  }
}

/** Executor that writes issue/revoke to the in-process control-list instead of Hedera. */
export class MockExecutor implements Executor {
  constructor(public controlList: InMemoryControlList) {}
  async execute(action: ControlAction): Promise<string> {
    if (action.kind === 'issue') {
      this.controlList.issue(this.controlList.agent, action.subject, BigInt(Math.round(action.units)));
    } else {
      this.controlList.revoke(this.controlList.agent, action.subject);
    }
    return fakeTxHash('0xexec');
  }
}

/** The x402 pay path's settle() for the agent's payForScore — mints a fake receipt. */
export async function mockSettle(): Promise<string> {
  return fakeTxHash('0xpay');
}
