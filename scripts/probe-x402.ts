/**
 * Live x402 round-trip against the Blocky402 facilitator (Path B, Hedera-native).
 * Builds a real signed HBAR payment, POSTs /verify, then /settle, and prints the
 * settlement tx. This confirms the exact payload shape and lands a real paid tx.
 *
 *   npm run probe:x402                 (pays 0.001 HBAR: buyer -> service treasury)
 *   npm run probe:x402 -- 500000       (custom amount in tinybars)
 *
 * Needs .env: HEDERA_PRIVATE_KEY + HEDERA_ACCOUNT_ID (the buyer), BLOCKY402_FACILITATOR_URL.
 */
import 'dotenv/config';
import { buildHederaPayment } from '../lib/live/hedera-payment';

const FEE_PAYER = '0.0.7162784'; // Blocky402 facilitator (from GET /supported)
const PAY_TO = process.env.X402_PAY_TO ?? '0.0.10476195'; // service treasury (agent account)
const HBAR_ASSET = '0.0.0'; // x402's asset id for native HBAR (verified vs @x402/hedera)

async function main() {
  const amount = process.argv[2] ?? '100000'; // tinybars; 100000 = 0.001 HBAR
  const base = process.env.BLOCKY402_FACILITATOR_URL;
  const payer = process.env.HEDERA_ACCOUNT_ID;
  const rawKey = process.env.HEDERA_PRIVATE_KEY;
  if (!base || !payer || !rawKey) throw new Error('Need BLOCKY402_FACILITATOR_URL, HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY');

  // x402 v2 PaymentRequirements (fields per @x402/core PaymentRequirementsV2Schema).
  const requirement = {
    scheme: 'exact',
    network: 'hedera:testnet',
    amount,
    asset: HBAR_ASSET,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { feePayer: FEE_PAYER },
  };

  console.log(`\nBuilding Hedera payment: ${payer} -> ${PAY_TO}, ${amount} tinybars, feePayer ${FEE_PAYER}...`);
  const transaction = await buildHederaPayment(
    { amount, payTo: PAY_TO, asset: HBAR_ASSET, feePayer: FEE_PAYER },
    { payerAccountId: payer, payerKeyHex: rawKey, network: 'hedera:testnet' },
  );
  // v2 payload carries the chosen requirements as `accepted` (NOT top-level scheme/network).
  const paymentPayload = { x402Version: 2, accepted: requirement, payload: { transaction } };

  const post = async (path: string) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirement }),
    });
    const text = await res.text();
    return { status: res.status, body: text };
  };

  console.log('\n[verify] POST /verify ...');
  const verify = await post('/verify');
  console.log(`  [HTTP ${verify.status}] ${verify.body}`);
  if (verify.status !== 200) throw new Error('verify failed — payload shape or funds issue');

  console.log('\n[settle] POST /settle ...');
  const settle = await post('/settle');
  console.log(`  [HTTP ${settle.status}] ${settle.body}`);

  try {
    const j = JSON.parse(settle.body);
    const txId: string | undefined = j.transaction ?? j.txHash ?? j.transactionHash ?? j.hash;
    // Hedera tx id "0.0.X@sec.nanos" -> HashScan path "0.0.X-sec-nanos".
    const m = txId?.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
    const path = m ? `${m[1]}-${m[2]}-${m[3]}` : txId;
    if (txId) console.log(`\nSettled. HashScan: https://hashscan.io/testnet/transaction/${path}`);
  } catch {
    /* body already printed */
  }
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
