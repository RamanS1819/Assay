/**
 * The whole system, end to end, against fixtures — no keys, no chain, no network.
 * Runs the five demo beats and returns a structured result so it can be asserted in
 * a test and printed by scripts/demo.ts. Swap the mock adapters for the live Privy /
 * Blocky402 / Graph clients and this same flow runs for real.
 */
import { runCycle, SimpleBudget, type LoopOps } from '../agent/loop';
import { underwrite as runUnderwrite } from '../agent/underwrite';
import { applyDecision } from '../agent/executor';
import { payForScore, paymentKey } from '../agent/pay';
import { getScore } from '../scorer/getScore';
import { InMemoryScoreCache, cacheKey } from '../scorer/cache';
import { InMemoryIntentStore } from '../agent/store';
import type { AuditEvent, UnderwritingDecision, Policy } from '../types/index';
import { InMemoryControlList } from './control-list';
import { demoChain, ADDR } from './fixtures';
import { mockScoreDeps, MockExecutor, mockSettle } from './adapters';

const AGENT = '0x00000000000000000000000000000000000a9e70';
const PRICE = 0.002;
const POLICY: Policy = { perRequestCapUsd: 0.05, dailyCapUsd: 5, quorumThresholdUnits: 10_000, quorumRequired: 2, quorumSigners: 3 };

export interface DemoResult {
  audit: AuditEvent[];
  controlList: InMemoryControlList;
  whaleIssued: boolean;
  distressedIssuedUnits: bigint;
  escalated: string[];
  approvedThenExecuted: string[];
  distressedRevoked: boolean;
  revertMessage: string | null;
}

export async function runDemo(log: (line: string) => void = () => {}): Promise<DemoResult> {
  const chain = demoChain();
  const controlList = new InMemoryControlList(AGENT);
  const cache = new InMemoryScoreCache();
  const scoreDeps = mockScoreDeps(chain, cache);
  const intents = new InMemoryIntentStore();
  const budget = new SimpleBudget(5);
  const audit: AuditEvent[] = [];
  const pendingApprovals: UnderwritingDecision[] = [];
  const now = () => new Date().toISOString();
  const pushAudit = async (e: AuditEvent) => { audit.push(e); };

  const ops = (): LoopOps => ({
    peekScore: (address, atBlock) => {
      const s = cache.get(cacheKey(address, atBlock));
      return s ? { asOfBlock: s.asOfBlock } : null;
    },
    buyScore: async (subject, atBlock) => {
      const key = paymentKey(subject.address, atBlock);
      const pay = await payForScore(subject.address, key, { intents, settle: mockSettle });
      audit.push({ type: 'payment', txHash: pay.txHash, amountUsd: PRICE, route: '/score', subject: subject.address, at: now() });
      const score = await getScore(subject.address, { atBlock, chain: 'ethereum' }, scoreDeps);
      audit.push({ type: 'score', subject: subject.address, value: score.value, asOfBlock: score.asOfBlock, at: now() });
      log(`  paid ${PRICE} (${pay.txHash}) -> score ${score.value} for ${subject.address.slice(0, 8)}`);
      return { score };
    },
    underwrite: async (score, subject) =>
      runUnderwrite({ score, exposureUnits: subject.exposureUnits, requestedUnits: subject.requestedUnits, policy: POLICY, maxLimitUnits: subject.requestedUnits }),
    execute: async (decision) =>
      applyDecision(decision, { executor: new MockExecutor(controlList), audit: pushAudit, now }),
    enqueueApproval: async (decision) => { pendingApprovals.push(decision); },
    audit: pushAudit,
  });

  const cfg = { price: PRICE, budget, now };

  // Beats 1-3: a small line issued autonomously
  log('BEAT 1-3  whale requests 5,000 units (small, under threshold)');
  await runCycle([{ address: ADDR.whale, exposureUnits: 0, requestedUnits: 5000 }], chain.headBlock(), ops(), cfg);
  const whaleIssued = controlList.isEligible(ADDR.whale);
  log(`  whale eligible=${whaleIssued}, balance=${controlList.balanceOf(ADDR.whale)}`);

  // distressed becomes a modest holder (so it has a line to pull later)
  await runCycle([{ address: ADDR.distressed, exposureUnits: 0, requestedUnits: 3000 }], chain.headBlock(), ops(), cfg);
  const distressedIssuedUnits = controlList.balanceOf(ADDR.distressed);

  // Beat 4: a large line trips the quorum -> escalate, then 2-of-3 approve, then execute
  log('BEAT 4    fresh applicant requests 50,000 units (large) -> escalation');
  await runCycle([{ address: ADDR.fresh, exposureUnits: 0, requestedUnits: 50_000 }], chain.headBlock(), ops(), cfg);
  const escalated = pendingApprovals.map((d) => d.subject);
  log(`  escalated: ${escalated.length ? escalated.map((a) => a.slice(0, 8)).join(', ') : 'none'} (attempt withheld)`);

  const approvedThenExecuted: string[] = [];
  for (const decision of pendingApprovals.splice(0)) {
    audit.push({ type: 'decision', subject: decision.subject, limit: decision.limit, escalated: false, at: now() });
    await applyDecision(decision, { executor: new MockExecutor(controlList), audit: pushAudit, now });
    approvedThenExecuted.push(decision.subject);
    log(`  2-of-3 signers approved -> issued ${decision.limit} to ${decision.subject.slice(0, 8)}`);
  }

  // Beat 5: liquidation -> re-score below the maintenance floor -> revoke -> transfer reverts
  log('BEAT 5    liquidation hits the distressed holder');
  chain.advance(400); // cross the score-cache bucket so the re-score is fresh
  chain.liquidate(ADDR.distressed);
  await runCycle(
    [{ address: ADDR.distressed, exposureUnits: Number(distressedIssuedUnits), requestedUnits: Number(distressedIssuedUnits) }],
    chain.headBlock(),
    ops(),
    cfg,
  );
  const distressedRevoked = !controlList.isEligible(ADDR.distressed);
  log(`  distressed eligible=${controlList.isEligible(ADDR.distressed)} (revoked=${distressedRevoked})`);

  let revertMessage: string | null = null;
  try {
    controlList.transfer(ADDR.distressed, ADDR.whale, 1n);
    log('  transfer SUCCEEDED (unexpected!)');
  } catch (e) {
    revertMessage = (e as Error).message;
    log(`  transfer REVERTED: ${revertMessage}  <- the money shot`);
  }

  return { audit, controlList, whaleIssued, distressedIssuedUnits, escalated, approvedThenExecuted, distressedRevoked, revertMessage };
}
