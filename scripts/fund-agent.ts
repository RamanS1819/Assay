/**
 * Fund the agent's Privy wallet with testnet HBAR from the deployer account, so it
 * can pay gas for control-list writes (issue/revoke). Sending HBAR to an EVM address
 * auto-creates its Hedera account.
 *
 *   npm run fund:agent            (sends 10 HBAR)
 *   npm run fund:agent -- 25      (sends 25 HBAR)
 */
import 'dotenv/config';
import { ethers } from 'ethers';

async function main() {
  const amountHbar = process.argv[2] ?? '10';
  const rpc = process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api';
  const rawKey = process.env.HEDERA_PRIVATE_KEY;
  const to = process.env.AGENT_WALLET_ADDRESS;
  if (!rawKey || !to) throw new Error('Need HEDERA_PRIVATE_KEY and AGENT_WALLET_ADDRESS in .env');

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`, provider);

  console.log(`Sending ${amountHbar} HBAR: ${wallet.address} -> ${to} ...`);
  const tx = await wallet.sendTransaction({ to, value: ethers.parseEther(amountHbar) }); // Hedera EVM: 1 HBAR = 1e18 weibar
  await tx.wait();

  const bal = await provider.getBalance(to);
  console.log(`Done. Agent balance: ${ethers.formatEther(bal)} HBAR`);
  console.log(`HashScan: https://hashscan.io/testnet/transaction/${tx.hash}`);
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
