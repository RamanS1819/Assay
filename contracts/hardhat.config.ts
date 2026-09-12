import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load the root .env (this Hardhat project sits in ./contracts).
dotenv.config({ path: resolve(__dirname, '../.env') });

// Accept the Hedera key with or without a 0x prefix.
const rawKey = process.env.HEDERA_PRIVATE_KEY;
const accounts = rawKey ? [rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`] : [];

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
      accounts,
      chainId: 296,
    },
  },
  // NOTE: `hardhat verify` (Hardhat 2's plugin) only speaks Sourcify's removed legacy
  // API and there is no Etherscan on Hedera — so verify via `npm run verify`
  // (scripts/verify-sourcify.mjs), which POSTs to Sourcify's v2 API. HashScan reads
  // Sourcify. Left enabled/disabled here only to keep the plugin quiet.
  sourcify: { enabled: true },
  etherscan: { enabled: false },
};

export default config;
