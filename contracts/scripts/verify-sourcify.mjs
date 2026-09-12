/**
 * Verify the deployed CreditToken on Sourcify's v2 API (which HashScan reads).
 * Hardhat 2's verify plugin only speaks Sourcify's removed legacy API, so we POST
 * the compiler Standard JSON input from the build-info directly.
 *
 *   node scripts/verify-sourcify.mjs [address]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ADDRESS = process.argv[2] ?? '0x2AB48b341a92A7b40636e2Ee6f88118B972aB824';
const CHAIN_ID = 296;
const IDENTIFIER = 'contracts/CreditToken.sol:CreditToken';
const SERVER = 'https://sourcify.dev/server';

const biDir = resolve(__dir, '../artifacts/build-info');
const biFile = readdirSync(biDir).find((f) => f.endsWith('.json'));
if (!biFile) throw new Error('no build-info found — run `npx hardhat compile` first');
const bi = JSON.parse(readFileSync(resolve(biDir, biFile), 'utf8'));

const body = {
  stdJsonInput: bi.input,
  compilerVersion: bi.solcLongVersion, // e.g. 0.8.24+commit.e11b9ed9
  contractIdentifier: IDENTIFIER,
};

console.log(`Verifying ${IDENTIFIER} @ ${ADDRESS} (chain ${CHAIN_ID})`);
console.log(`  solc ${bi.solcLongVersion}, ${Object.keys(bi.input.sources).length} sources`);

const post = await fetch(`${SERVER}/v2/verify/${CHAIN_ID}/${ADDRESS}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const posted = await post.json().catch(() => ({}));
console.log(`  POST /v2/verify -> [${post.status}] ${JSON.stringify(posted)}`);

if (post.status === 200 || post.status === 201) {
  // already verified / synchronous match
} else if (post.status === 202 && posted.verificationId) {
  const id = posted.verificationId;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${SERVER}/v2/verify/${id}`);
    const job = await res.json().catch(() => ({}));
    if (job.isJobCompleted) {
      console.log(`  job done: ${JSON.stringify(job.contract ?? job)}`);
      break;
    }
    process.stdout.write('.');
  }
} else {
  throw new Error(`unexpected verify response ${post.status}`);
}

console.log(`\nHashScan: https://hashscan.io/testnet/contract/${ADDRESS}`);
