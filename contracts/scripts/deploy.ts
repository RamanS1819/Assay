import { ethers, run } from 'hardhat';

/**
 * Deploys CreditToken to Hedera testnet and (optionally) verifies it on HashScan.
 *
 *   AGENT_WALLET_ADDRESS=0x...  npx hardhat run scripts/deploy.ts --network hederaTestnet
 *   VERIFY=1 ...                # also verify via Sourcify (HashScan reads it)
 *
 * AGENT_WALLET_ADDRESS is the agent's Privy server-wallet address — the only
 * account allowed to issue credit and change eligibility.
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

  if (process.env.VERIFY === '1') {
    console.log('Waiting for confirmations before verifying...');
    await token.deploymentTransaction()?.wait(3);
    await run('verify:verify', { address, constructorArguments: ['Assay Credit', 'ACR', agent] });
    console.log('Verified on Sourcify — HashScan will show the source.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
