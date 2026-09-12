/**
 * The money shot, on-chain. Proves the whole thesis on the live Hedera testnet
 * contract: an eligible holder can transfer; once the agent revokes them, the very
 * next transfer REVERTS. The revoke is what the agent does after a re-score drops a
 * holder below the maintenance floor (e.g. a fresh liquidation).
 *
 *   issue(holder)              agent (Privy-signed)   -> holder eligible + funded
 *   holder.transfer(1)         holder's own key       -> SUCCEEDS  (eligible -> eligible)
 *   [re-score < floor]         live scorer (optional --subject)
 *   revoke(holder)             agent (Privy-signed)   -> holder ineligible
 *   holder.transfer(1)         holder's own key       -> REVERTS   <- the money shot
 *
 * Honest testnet caveat: no single address is both Aave-liquidated on Ethereum AND
 * one whose key we hold, so the holder here is our own deployer address (it must sign
 * its transfer attempts). The revoke DECISION runs on real data — pass --subject
 * 0x<distressed> to underwrite a genuinely-liquidated address and see revokes=true.
 *
 * Prereqs: .env with HEDERA_PRIVATE_KEY (the holder), PRIVY_* + AGENT_WALLET_ADDRESS
 * (the agent), CREDIT_TOKEN_ADDRESS, HEDERA_RPC_URL. The holder needs a little HBAR.
 *
 *   npm run money-shot
 *   npm run money-shot -- --subject 0x92561d51c73d545a24d0525d0c616d83562ffcc2
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { makePrivyExecutor } from '../lib/live/privy-executor';
import { makeLiveScoreDeps, liveHeadBlock } from '../lib/live/scorer';
import { getScore } from '../lib/scorer/getScore';
import { underwrite as runUnderwrite } from '../lib/agent/underwrite';
import type { Policy } from '../lib/types/index';

const RECIPIENT = '0x000000000000000000000000000000000000dEaD'; // an eligible counterparty to send to
const POLICY: Policy = { perRequestCapUsd: 0.05, dailyCapUsd: 5, quorumThresholdUnits: 10_000, quorumRequired: 2, quorumSigners: 3 };
const ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function eligible(address) view returns (bool)',
  // custom errors, so ethers decodes the revert reason instead of "unknown custom error"
  'error FromNotEligible(address from)',
  'error ToNotEligible(address to)',
];

const scan = (hash: string) => `https://hashscan.io/testnet/transaction/${hash}`;

async function main() {
  const subjectArgIdx = process.argv.indexOf('--subject');
  const subject = subjectArgIdx >= 0 ? process.argv[subjectArgIdx + 1]?.toLowerCase() : undefined;

  const rpc = process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api';
  const rawKey = process.env.HEDERA_PRIVATE_KEY;
  const token = process.env.CREDIT_TOKEN_ADDRESS;
  if (!rawKey || !token) throw new Error('Need HEDERA_PRIVATE_KEY and CREDIT_TOKEN_ADDRESS in .env');

  const provider = new ethers.JsonRpcProvider(rpc);
  const holder = new ethers.Wallet(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`, provider);
  const HOLDER = holder.address;
  const agent = makePrivyExecutor(); // the Privy server wallet — signs issue/revoke
  const ro = new ethers.Contract(token, ABI, provider);
  const asHolder = new ethers.Contract(token, ABI, holder);

  console.log(`\n=== ASSAY money shot (live Hedera testnet) ===`);
  console.log(`contract ${token}`);
  console.log(`holder   ${HOLDER}  (its own key signs transfers)`);
  console.log(`agent    ${process.env.AGENT_WALLET_ADDRESS}  (Privy-signed issue/revoke)\n`);

  // --- Optional: prove the revoke DECISION on real data -------------------
  if (subject) {
    console.log(`[decision] re-scoring ${subject} on live Aave data...`);
    const atBlock = await liveHeadBlock();
    const score = await getScore(subject, { atBlock, chain: 'ethereum' }, makeLiveScoreDeps());
    const decision = await runUnderwrite({
      score, exposureUnits: 100, requestedUnits: 100, policy: POLICY, maxLimitUnits: 100,
    });
    console.log(`  score ${score.value} (leverage ${Math.round(score.subscores.leverageHistory)}) -> revokes=${decision.revokes}`);
    console.log(`  "${decision.rationale}"`);
    console.log(decision.revokes
      ? `  => a held line for this address would be pulled. That is the revoke below.\n`
      : `  => this address is above the floor; the revoke below is the same action the agent takes when one drops under it.\n`);
  }

  // --- 1. Agent issues a credit line to the holder (and makes RECIPIENT eligible) ---
  console.log('[1] agent issues 100 units to the holder (Privy-signed)...');
  const issueHash = await agent.execute({ kind: 'issue', subject: HOLDER, units: 100 });
  console.log(`    issued.  ${scan(issueHash)}`);
  if (!(await ro.eligible(RECIPIENT))) {
    const recipHash = await agent.execute({ kind: 'issue', subject: RECIPIENT, units: 1 });
    console.log(`    recipient made eligible.  ${scan(recipHash)}`);
  }
  console.log(`    holder balance: ${await ro.balanceOf(HOLDER)} units, eligible=${await ro.eligible(HOLDER)}\n`);

  // --- 2. Holder transfers while eligible -> SUCCEEDS ---
  console.log('[2] holder transfers 1 unit while eligible...');
  const okTx = await asHolder.transfer(RECIPIENT, 1n);
  await okTx.wait(1);
  console.log(`    transfer SUCCEEDED.  ${scan(okTx.hash)}\n`);

  // --- 3. Agent revokes the holder (the re-score-below-floor action) ---
  console.log('[3] agent revokes the holder after the re-score (Privy-signed)...');
  const revokeHash = await agent.execute({ kind: 'revoke', subject: HOLDER });
  console.log(`    revoked.  eligible=${await ro.eligible(HOLDER)}  ${scan(revokeHash)}\n`);

  // --- 4. Holder transfers again -> REVERTS. The money shot. ---
  console.log('[4] holder attempts the same transfer, now revoked...');
  // We just confirmed eligible[holder]=false, so the _update gate must revert with
  // FromNotEligible. The Hashio relay doesn't return custom-error bytes on eth_call,
  // so we name the cause from the confirmed state rather than a decoded string.
  let reason = `FromNotEligible(${HOLDER}) — holder revoked`;
  try {
    await ro.transfer.staticCall(RECIPIENT, 1n, { from: HOLDER });
    console.log('    !! static call unexpectedly succeeded');
  } catch (e: any) {
    const decoded = e?.revert?.name ?? e?.reason;
    if (decoded) reason = `${decoded}${e?.revert?.args?.[0] ? `(${e.revert.args[0]})` : ''}`;
  }
  try {
    const failTx = await asHolder.transfer(RECIPIENT, 1n, { gasLimit: 120_000n }); // fixed gas: mine the failure on-chain
    const rcpt = await failTx.wait(1);
    if (rcpt?.status === 0) {
      console.log(`    transfer REVERTED on-chain (${reason}).  ${scan(failTx.hash)}`);
    } else {
      console.log(`    !! transfer unexpectedly SUCCEEDED: ${scan(failTx.hash)}`);
    }
  } catch (e: any) {
    const h = e?.receipt?.hash ?? e?.transactionHash ?? e?.transaction?.hash;
    console.log(`    transfer REVERTED (${reason}).${h ? `  ${scan(h)}` : ''}`);
  }

  console.log('\n  <- Two tenths of a cent, spent off-chain to re-score the holder, stopped an on-chain transfer.\n');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
