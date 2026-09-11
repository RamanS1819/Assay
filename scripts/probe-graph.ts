/**
 * Probe the live Aave subgraph to verify our GraphQL field names against the real
 * Messari schema (resolves the "reconstruction" flag in lib/scorer/sources.ts).
 *
 *   1. put GRAPH_API_KEY + GRAPH_LENDING_SUBGRAPH_URL in .env
 *   2. npm run probe:graph -- 0xADDRESS   (an address with Aave v3 borrowing history)
 *
 * Prints the parsed lending data, a computed score, and the recent-liquidations count.
 * If the fields are wrong, the parsed data comes back empty/zeroed — that's the signal
 * to adjust the query in sources.ts.
 */
import 'dotenv/config';
import { fetchHeadBlock, fetchLending, fetchLiquidations } from '../lib/scorer/sources';
import { toScoreInputs } from '../lib/scorer/map';
import { computeScore } from '../lib/scorer/model';

async function main() {
  const address = process.argv[2];
  if (!address) {
    console.error('Usage: npm run probe:graph -- 0xADDRESS  (an address with Aave v3 borrowing history)');
    process.exit(1);
  }

  const head = await fetchHeadBlock();
  console.log(`Subgraph head block: ${head}`);

  const lending = await fetchLending(address);
  console.log('\nParsed lending data:');
  console.log(JSON.stringify(lending, null, 2));

  const inputs = toScoreInputs({ lending, portfolio: [] });
  const score = computeScore(inputs, { address, chain: 'ethereum', asOfBlock: lending.currentBlock, inputs: ['messari-lending'] });
  console.log(`\nComputed score: ${score.value}`);
  console.log('Subscores:', score.subscores);

  const recent = await fetchLiquidations(Math.max(0, lending.currentBlock - 5000), lending.currentBlock);
  console.log(`\nRecent liquidations (last ~5000 blocks): ${recent.length}`);

  if (lending.txCount === 0 && lending.liquidationCount === 0 && lending.openBorrowsUsd === 0) {
    console.log('\nNote: everything parsed to zero. Either this address has no Aave activity,');
    console.log('or the GraphQL field names in sources.ts need adjusting for this subgraph.');
  }
}

main().catch((err) => {
  console.error('\nProbe failed:', err);
  process.exit(1);
});
