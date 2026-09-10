/**
 * Live executor — writes issue/revoke to the CreditToken on Hedera.
 *
 *   ControlAction ─▶ encode calldata (issue/revoke)
 *        │
 *        ▼   Privy signs the chain-296 tx (holds the key, enforces policy)
 *   privy.walletApi.ethereum.signTransaction({ walletId, transaction })  ->  signedTransaction
 *        │
 *        ▼   WE broadcast to Hedera (Privy never talks to Hedera) and WAIT for the receipt
 *   provider.broadcastTransaction() -> wait(1)   (on-chain confirmation = source of truth)
 *        ▼
 *   return the confirmed tx hash
 *
 * Implements the Executor interface, so it's a drop-in replacement for MockExecutor.
 * Verified against @privy-io/server-auth v1.32.5 + ethers v6.
 */
import { ethers } from 'ethers';
import { PrivyClient } from '@privy-io/server-auth';
import type { Executor, ControlAction } from '../agent/executor';

export const CREDIT_TOKEN_ABI = [
  'function issue(address to, uint256 amount)',
  'function revoke(address holder)',
  'function setEligible(address holder, bool value)',
] as const;

/** Pure: ControlAction -> calldata. Unit-tested. */
export function encodeAction(action: ControlAction, iface: ethers.Interface): string {
  if (action.kind === 'issue') {
    return iface.encodeFunctionData('issue', [action.subject, BigInt(Math.round(action.units))]);
  }
  return iface.encodeFunctionData('revoke', [action.subject]);
}

const toHex = (n: bigint | number): `0x${string}` => `0x${BigInt(n).toString(16)}`;

export interface PrivyExecutorConfig {
  privy: PrivyClient;
  walletId: string; // PRIVY_WALLET_ID
  fromAddress: string; // AGENT_WALLET_ADDRESS
  tokenAddress: string; // deployed CreditToken address
  rpcUrl: string; // Hedera JSON-RPC relay
  chainId?: number; // default 296 (Hedera testnet)
  gasLimitFallback?: bigint;
}

export class PrivyExecutor implements Executor {
  private provider: ethers.JsonRpcProvider;
  private iface: ethers.Interface;
  private chainId: number;

  constructor(private cfg: PrivyExecutorConfig) {
    this.provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    this.iface = new ethers.Interface([...CREDIT_TOKEN_ABI]);
    this.chainId = cfg.chainId ?? 296;
  }

  async execute(action: ControlAction): Promise<string> {
    const data = encodeAction(action, this.iface);
    const from = this.cfg.fromAddress;
    const to = this.cfg.tokenAddress;

    const [nonce, feeData] = await Promise.all([
      this.provider.getTransactionCount(from, 'pending'),
      this.provider.getFeeData(),
    ]);

    let gasLimit: bigint;
    try {
      gasLimit = ((await this.provider.estimateGas({ from, to, data })) * 12n) / 10n; // +20% headroom
    } catch {
      gasLimit = this.cfg.gasLimitFallback ?? 1_000_000n;
    }

    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? maxFeePerGas;

    // Privy holds the key + enforces policy; it signs, it does not broadcast.
    const { signedTransaction } = await this.cfg.privy.walletApi.ethereum.signTransaction({
      walletId: this.cfg.walletId,
      transaction: {
        from: from as `0x${string}`,
        to: to as `0x${string}`,
        data: data as `0x${string}`,
        nonce,
        chainId: this.chainId,
        type: 2,
        gasLimit: toHex(gasLimit),
        maxFeePerGas: toHex(maxFeePerGas),
        maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
      },
    });

    // We broadcast to Hedera and WAIT — the DB only trusts a confirmed receipt.
    const sent = await this.provider.broadcastTransaction(signedTransaction);
    const receipt = await sent.wait(1);
    if (!receipt || receipt.status !== 1) {
      throw new Error(`control-list ${action.kind} for ${action.subject} failed on-chain: ${sent.hash}`);
    }
    return sent.hash;
  }
}

/** Build a PrivyExecutor from env. Used by the agent worker (scripts/agent.ts). */
export function makePrivyExecutor(): PrivyExecutor {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_KEY;
  const walletId = process.env.PRIVY_WALLET_ID;
  const fromAddress = process.env.AGENT_WALLET_ADDRESS;
  const tokenAddress = process.env.CREDIT_TOKEN_ADDRESS;
  const rpcUrl = process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api';

  const missing = Object.entries({ appId, appSecret, authorizationPrivateKey, walletId, fromAddress, tokenAddress })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`makePrivyExecutor: missing env for ${missing.join(', ')}`);

  const privy = new PrivyClient(appId!, appSecret!, { walletApi: { authorizationPrivateKey: authorizationPrivateKey! } });
  return new PrivyExecutor({ privy, walletId: walletId!, fromAddress: fromAddress!, tokenAddress: tokenAddress!, rpcUrl });
}
