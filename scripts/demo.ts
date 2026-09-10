/**
 * Offline end-to-end demo. Runs the whole Assay flow against fixtures — no keys,
 * no chain, no network. Prints each beat and the final audit trail.
 *
 *   npm run demo
 */
import { runDemo } from '../lib/mock/demo';

async function main() {
  console.log('\n=== ASSAY — offline demo (fixtures, no keys) ===\n');
  const r = await runDemo((line) => console.log(line));

  console.log('\n--- AUDIT TRAIL ---');
  for (const e of r.audit) {
    switch (e.type) {
      case 'payment':
        console.log(`  pay      $${e.amountUsd}  ${e.txHash}  ${e.route}  ${e.subject.slice(0, 10)}`);
        break;
      case 'score':
        console.log(`  score    ${e.value}  @block ${e.asOfBlock}  ${e.subject.slice(0, 10)}`);
        break;
      case 'decision':
        console.log(`  decision limit=${e.limit}  escalated=${e.escalated}  ${e.subject.slice(0, 10)}`);
        break;
      case 'execution':
        console.log(`  exec     ${e.action}  ${e.txHash}  ${e.subject.slice(0, 10)}`);
        break;
      case 'skip':
        console.log(`  skip     ${e.reason}  ${e.subject.slice(0, 10)}`);
        break;
      case 'error':
        console.log(`  error    ${e.source}: ${e.message}`);
        break;
    }
  }

  console.log('\n--- RESULT ---');
  console.log(`  whale issued:        ${r.whaleIssued}`);
  console.log(`  escalated:           ${r.escalated.join(', ') || 'none'}`);
  console.log(`  approved + executed: ${r.approvedThenExecuted.join(', ') || 'none'}`);
  console.log(`  distressed revoked:  ${r.distressedRevoked}`);
  console.log(`  revert:              ${r.revertMessage ?? 'none'}`);
  console.log('');

  if (!r.distressedRevoked || !r.revertMessage) {
    process.exitCode = 1;
    console.error('DEMO FAILED: beat 5 did not revert.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
