/**
 * Smoke test the live PrivyExecutor: sign an issue/revoke with Privy and broadcast
 * it to Hedera. Proves the one thing only verified at the type level so far — that
 * Privy produces a valid chain-296 signature that actually lands on-chain.
 *
 *   1. .env needs PRIVY_* + AGENT_WALLET_ADDRESS + CREDIT_TOKEN_ADDRESS + HEDERA_RPC_URL
 *   2. Fund AGENT_WALLET_ADDRESS with a little testnet HBAR (it pays this tx's gas)
 *   3. npm run smoke:executor -- 0xSUBJECT issue    (or: ... revoke)
 */
import 'dotenv/config';
import { makePrivyExecutor } from '../lib/live/privy-executor';

async function main() {
  const subject = process.argv[2] ?? '0x000000000000000000000000000000000000dEaD';
  const action = (process.argv[3] as 'issue' | 'revoke') ?? 'issue';

  const executor = makePrivyExecutor();
  console.log(`Signing ${action}(${subject}) with Privy and broadcasting to Hedera...`);

  const tx =
    action === 'revoke'
      ? await executor.execute({ kind: 'revoke', subject })
      : await executor.execute({ kind: 'issue', subject, units: 100 });

  console.log(`\nConfirmed on-chain: ${tx}`);
  console.log(`HashScan: https://hashscan.io/testnet/transaction/${tx}`);
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
