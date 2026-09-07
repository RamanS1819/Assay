import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

// evmVersion "paris" keeps bytecode compatible with Hedera's EVM (avoids Cancun-only
// opcodes). chainId 296 = Hedera testnet; hashio is a free public JSON-RPC relay.
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
    },
  },
  networks: {
    hederaTestnet: {
      url: process.env.HEDERA_RPC_URL || 'https://testnet.hashio.io/api',
      accounts: process.env.HEDERA_PRIVATE_KEY ? [process.env.HEDERA_PRIVATE_KEY] : [],
      chainId: 296,
    },
  },
  // HashScan reads Sourcify — `VERIFY=1` in the deploy script verifies the contract.
  sourcify: { enabled: true },
};

export default config;
