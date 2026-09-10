/**
 * One-time setup: creates the agent's Privy server wallet and prints the two
 * derived .env values (PRIVY_WALLET_ID + AGENT_WALLET_ADDRESS).
 *
 *   1. put PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_AUTHORIZATION_KEY in .env
 *   2. npm run privy:wallet
 *   3. paste the two printed lines into .env
 *
 * The wallet is owned by your authorization key's default quorum, so your backend
 * (this key) is what controls it. AGENT_WALLET_ADDRESS becomes the issuer on the
 * CreditToken. Verified against @privy-io/server-auth v1.32.5.
 */
import 'dotenv/config';
import { PrivyClient } from '@privy-io/server-auth';

const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_KEY;

if (!appId || !appSecret || !authorizationPrivateKey) {
  console.error('Missing PRIVY_APP_ID, PRIVY_APP_SECRET, or PRIVY_AUTHORIZATION_KEY in .env');
  process.exit(1);
}

const privy = new PrivyClient(appId, appSecret, {
  walletApi: { authorizationPrivateKey },
});

async function main() {
  const wallet = await privy.walletApi.createWallet({ chainType: 'ethereum' });
  console.log('\n Server wallet created. Add these two lines to your .env:\n');
  console.log(`PRIVY_WALLET_ID=${wallet.id}`);
  console.log(`AGENT_WALLET_ADDRESS=${wallet.address}`);
  console.log('\n(AGENT_WALLET_ADDRESS is the issuer on your CreditToken — use it when you deploy.)\n');
}

main().catch((err) => {
  console.error('\n Wallet creation failed:\n', err);
  process.exit(1);
});
