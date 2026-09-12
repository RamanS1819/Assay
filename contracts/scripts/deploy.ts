import { ethers } from 'hardhat';

/**
 * Deploys CreditToken to Hedera testnet.
 *
 *   AGENT_WALLET_ADDRESS=0x...  npx hardhat run scripts/deploy.ts --network hederaTestnet
 *
 * AGENT_WALLET_ADDRESS is the agent's Privy server-wallet address — the only
 * account allowed to issue credit and change eligibility.
 *
 * To verify on HashScan afterwards, run `npm run verify` (scripts/verify-sourcify.mjs):
 * Hardhat 2's verify plugin can't reach Sourcify's current API, so we POST directly.
 */
async function main() {
  const agent = process.env.AGENT_WALLET_ADDRESS;
  if (!agent) throw new Error('Set AGENT_WALLET_ADDRESS (the agent wallet that may issue/revoke)');

  const Factory = await ethers.getContractFactory('CreditToken');
  const token = await Factory.deploy('Assay Credit', 'ACR', agent);
  await token.waitForDeployment();
  const address = await token.getAddress();

  console.log(`CreditToken deployed: ${address}`);
  console.log(`Agent (issuer):       ${agent}`);
  console.log(`HashScan:             https://hashscan.io/testnet/contract/${address}`);
  console.log(`\nVerify the source with:  npm run verify -- ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
