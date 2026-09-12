/**
 * The live agent worker. Runs one real cycle of the loop against live data and
 * writes the result to Neon, so the console shows real scores, real decisions and
 * a real holder register instead of the canned demo state.
 *
 *   score (live Graph)  ->  underwrite  ->  persist (scores/decisions/holders/audit)
 *                                            └─ with --execute: issue/revoke on Hedera (Privy-signed)
 *
 * Usage:
 *   npm run agent -- 0xADDR1 0xADDR2            score + decide + persist (no chain writes)
 *   npm run agent -- --discover 3              auto-pick recently-liquidated addresses
 *   npm run agent -- 0xADDR --pay              BUY each score over x402 (real HBAR, needs the app up)
 *   npm run agent -- 0xADDR --execute          also issue/revoke on-chain (costs gas)
 *   npm run agent -- 0xADDR --requested 8000   requested credit line per subject
 *
 * What is LIVE here: the scorer (real Aave data via The Graph); with --pay the agent
 * is a real paying customer of its own bureau (x402 -> Blocky402 settles HBAR, the
 * /api/score route records the payment); with --execute the executor writes the
 * CreditToken on Hedera (Privy-signed). Default is score + decide + persist only.
 */
import 'dotenv/config';
import { runCycle, SimpleBudget, type LoopOps, type Subject } from '../lib/agent/loop';
import { underwrite as runUnderwrite } from '../lib/agent/underwrite';
import { applyDecision } from '../lib/agent/executor';
import { getScore } from '../lib/scorer/getScore';
import { InMemoryScoreCache, cacheKey } from '../lib/scorer/cache';
import { makeLiveScoreDeps, liveHeadBlock } from '../lib/live/scorer';
import { makePrivyExecutor } from '../lib/live/privy-executor';
import { x402Fetch } from '../lib/live/x402-client';
import { makeBuyerPaymentBuilder } from '../lib/live/x402-gateway';
import { makeSql } from '../lib/db/client';
import { AuditRepo, ScoresRepo, DecisionsRepo, HoldersRepo, type DecisionState } from '../lib/db/repos';
import { fetchLiquidations } from '../lib/scorer/sources';
import type { AuditEvent, Policy, Score } from '../lib/types/index';

const QUERY_PRICE_USD = 0.002; // the advertised per-query price the budget cap tracks
const POLICY: Policy = { perRequestCapUsd: 0.05, dailyCapUsd: 5, quorumThresholdUnits: 10_000, quorumRequired: 2, quorumSigners: 3 };

interface Args {
  addresses: string[];
  execute: boolean;
  pay: boolean;
  discover: number;
  requested: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { addresses: [], execute: false, pay: false, discover: 0, requested: 5000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--pay') args.pay = true;
    else if (a === '--discover') args.discover = Number(argv[++i] ?? '1');
    else if (a === '--requested') args.requested = Number(argv[++i] ?? '5000');
    else if (a.startsWith('0x')) args.addresses.push(a.toLowerCase());
    else throw new Error(`Unrecognized argument: ${a}`);
  }
  return args;
}

/** Pull recently-liquidated addresses off The Graph to use as subjects. */
async function discover(n: number): Promise<string[]> {
  const head = await liveHeadBlock();
  const events = await fetchLiquidations(Math.max(0, head - 10_000), head);
  const unique = [...new Set(events.map((e) => e.liquidatee))];
  return unique.slice(0, n);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = makeSql();

  let addresses = args.addresses;
  if (args.discover > 0) {
    const found = await discover(args.discover);
    console.log(`Discovered ${found.length} recently-liquidated address(es).`);
    addresses = [...new Set([...addresses, ...found])];
  }
  if (addresses.length === 0) {
    throw new Error('No subjects. Pass addresses (0x...) or --discover N.');
  }

  // Current exposure per subject drives revocation: a held address whose fresh score
  // falls below the maintenance floor gets its line pulled.
  const exposureByAddr = new Map<string, number>();
  for (const addr of addresses) {
    const rows = await sql<{ units: string | number }>`SELECT units FROM holders WHERE address = ${addr}`;
    exposureByAddr.set(addr, rows[0] ? Number(rows[0].units) : 0);
  }
  const subjects: Subject[] = addresses.map((address) => ({
    address,
    exposureUnits: exposureByAddr.get(address) ?? 0,
    requestedUnits: args.requested,
  }));

  const cache = new InMemoryScoreCache();
  const scoreDeps = makeLiveScoreDeps(cache);
  const atBlock = await liveHeadBlock();

  const audit = new AuditRepo(sql);
  const scores = new ScoresRepo(sql);
  const decisions = new DecisionsRepo(sql);
  const holders = new HoldersRepo(sql);
  const now = () => new Date().toISOString();
  const append = (e: AuditEvent) => audit.append(e);

  const executor = args.execute ? makePrivyExecutor() : null;
  const buyPayment = args.pay ? makeBuyerPaymentBuilder() : null;
  const appBase = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const price = args.pay ? QUERY_PRICE_USD : 0;

  if (args.pay) console.log(`--pay: buying each score over x402 (real HBAR via Blocky402) from ${appBase}/api/score`);
  if (args.execute) console.log('--execute: on-chain issue/revoke ENABLED (Privy-signed, costs gas).');
  if (!args.pay && !args.execute) console.log('record-only: scoring + underwriting persisted; no chain writes, no payment.');
  console.log('');

  const ops: LoopOps = {
    peekScore: (address, block) => {
      const s = cache.get(cacheKey(address, block));
      return s ? { asOfBlock: s.asOfBlock } : null;
    },
    buyScore: async (subject, block) => {
      if (buyPayment) {
        // Pay per query: the /api/score route settles the HBAR and records the
        // payment + score, so we don't persist them again here.
        const out = await x402Fetch<Score>(`${appBase}/api/score?address=${subject.address}`, buyPayment);
        const score = out.data;
        console.log(`  bought score ${score.value}  (paid ${out.paymentTxHash ?? 'n/a'})  ${subject.address}`);
        return { score };
      }
      const score = await getScore(subject.address, { atBlock: block, chain: 'ethereum' }, scoreDeps);
      await scores.save(score);
      await append({ type: 'score', subject: subject.address, value: score.value, asOfBlock: score.asOfBlock, at: now() });
      console.log(`  score ${score.value}  (leverage ${Math.round(score.subscores.leverageHistory)}, portfolio ${Math.round(score.subscores.portfolioQuality)})  ${subject.address}`);
      return { score };
    },
    underwrite: (score, subject) =>
      runUnderwrite({ score, exposureUnits: subject.exposureUnits, requestedUnits: subject.requestedUnits, policy: POLICY, maxLimitUnits: subject.requestedUnits }),
    execute: async (decision) => {
      const state: DecisionState = decision.revokes ? 'revoked' : 'issued';
      let txHash = 'record-only';
      if (executor) {
        // applyDecision signs via Privy, broadcasts to Hedera, waits, and audits the execution.
        txHash = await applyDecision(decision, { executor, audit: append, now });
      }
      await decisions.record(decision, state);
      const exposure = exposureByAddr.get(decision.subject) ?? 0;
      await holders.upsert({
        address: decision.subject,
        units: decision.revokes ? exposure : decision.limit,
        eligible: !decision.revokes,
        limit: decision.limit,
      });
      console.log(`  ${state}  limit=${decision.limit}  ${executor ? txHash : '(not executed)'}  ${decision.subject}`);
      return txHash;
    },
    enqueueApproval: async (decision) => {
      await decisions.record(decision, 'escalated');
      console.log(`  escalated  limit=${decision.limit}  (2-of-3 quorum required)  ${decision.subject}`);
    },
    audit: append,
  };

  console.log(`Scoring ${subjects.length} subject(s) @ block ${atBlock}...\n`);
  const result = await runCycle(subjects, atBlock, ops, { price, budget: new SimpleBudget(POLICY.dailyCapUsd), now });

  console.log('\n--- CYCLE ---');
  console.log(`  scored:    ${result.scored.length}`);
  console.log(`  issued:    ${result.issued.length}`);
  console.log(`  escalated: ${result.escalated.length}`);
  console.log(`  skipped:   ${result.skipped.map((s) => `${s.subject.slice(0, 10)} (${s.reason})`).join(', ') || 'none'}`);
  console.log('\nDone. The console now reflects this cycle (holders / decisions / audit).');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
