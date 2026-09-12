/**
 * Buy a score through the live x402 paywall — the full pay-per-query loop:
 *   GET /api/score -> 402 -> sign an HBAR payment -> retry -> 200 + score.
 * Blocky402 settles the payment; the route records it, so the console's spend +
 * audit feed reflect a real paid query.
 *
 *   npm run dev            (in another terminal — the route must be running)
 *   npm run buy:score                 (scores a default address)
 *   npm run buy:score -- 0xADDRESS
 *
 * Needs .env: HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY (the buyer), and the app up.
 */
import 'dotenv/config';
import { x402Fetch } from '../lib/live/x402-client';
import { makeBuyerPaymentBuilder } from '../lib/live/x402-gateway';

const hashscan = (txId: string) => {
  const m = txId.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
  return `https://hashscan.io/testnet/transaction/${m ? `${m[1]}-${m[2]}-${m[3]}` : txId}`;
};

async function main() {
  const address = (process.argv[2] ?? '0x0fbf1f34b217bdc1cfe8262c994d999cc2c57bc6').toLowerCase();
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const url = `${base}/api/score?address=${address}`;

  console.log(`\nBuying a score for ${address} via x402...\n  ${url}`);
  const out = await x402Fetch<{ value: number; subscores: Record<string, number> }>(url, makeBuyerPaymentBuilder());

  console.log(`\nGot score: ${out.data.value}`);
  if (out.paymentTxHash) console.log(`Paid (settled by Blocky402): ${out.paymentTxHash}\n  ${hashscan(out.paymentTxHash)}`);
  else console.log('(no settlement tx returned — route may be free or misconfigured)');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
