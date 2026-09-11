/**
 * Probe the live Aave subgraph to verify our GraphQL field names against the real
 * Messari schema (resolves the "reconstruction" flag in lib/scorer/sources.ts).
 *
 *   1. put GRAPH_API_KEY + GRAPH_LENDING_SUBGRAPH_URL in .env
 *   2. npm run probe:graph              (auto-picks a recently-liquidated address)
 *      npm run probe:graph -- 0xADDR    (or probe a specific address)
 *
 * Prints the head block, the address used, parsed lending data, a computed score,
 * and the recent-liquidations count. Real numbers = the scorer is live and correct.
 */
import 'dotenv/config';
import { fetchHeadBlock, fetchLending, fetchLiquidations } from '../lib/scorer/sources';
import { toScoreInputs } from '../lib/scorer/map';
import { computeScore } from '../lib/scorer/model';

async function pickLiquidatedAddress(head: number): Promise<string | null> {
  for (const span of [200_000, 2_000_000, 10_000_000]) {
    const liqs = await fetchLiquidations(Math.max(0, head - span), head);
    if (liqs.length > 0) {
      console.log(`Found ${liqs.length} liquidations in the last ~${span} blocks.`);
      return liqs[liqs.length - 1].liquidatee; // most recent liquidatee has real lending history
    }
  }
  return null;
}

async function main() {
  const head = await fetchHeadBlock();
  console.log(`Subgraph head block: ${head}`);
  if (head === 0) {
    console.error('\nHead block is 0 — the subgraph is unreachable. Check GRAPH_API_KEY and GRAPH_LENDING_SUBGRAPH_URL.');
    process.exit(1);
  }

  let address = process.argv[2];
  if (!address) {
    console.log('No address given — finding a recently-liquidated address from the subgraph...');
    const found = await pickLiquidatedAddress(head);
    if (!found) {
      console.error('\nNo liquidations found (unexpected for Aave). Pass one explicitly: npm run probe:graph -- 0xADDR');
      process.exit(1);
    }
    address = found;
  }
  console.log(`Probing address: ${address}`);

  const lending = await fetchLending(address);
  console.log('\nParsed lending data:');
  console.log(JSON.stringify(lending, null, 2));

  const inputs = toScoreInputs({ lending, portfolio: [] });
  const score = computeScore(inputs, { address, chain: 'ethereum', asOfBlock: lending.currentBlock, inputs: ['messari-lending'] });
  console.log(`\nComputed score: ${score.value}`);
  console.log('Subscores:', score.subscores);

  if (lending.txCount === 0 && lending.liquidationCount === 0 && lending.openBorrowsUsd === 0 && lending.collateralUsd === 0) {
    console.log('\nNote: this account parsed to all-zero. If the address was auto-picked (so it IS active),');
    console.log('that points to a field-name mismatch in sources.ts rather than an inactive address.');
  }
}

main().catch((err) => {
  console.error('\nProbe failed:', err);
  process.exit(1);
});
