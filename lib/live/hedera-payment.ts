/**
 * Path B — the Hedera-native x402 payment payload (Blocky402 facilitator).
 *
 * The buyer of a score builds a native Hedera TransferTransaction moving `amount`
 * base units to the service (payTo), with the facilitator's account as the fee payer
 * (via the transaction id). The buyer PARTIAL-signs it; the facilitator adds its
 * fee-payer signature and broadcasts. The base64 of that partially-signed tx is
 * `paymentPayload.payload.transaction`.
 *
 * We delegate the tx construction + signing to the official @x402/hedera
 * `createClientHederaSigner` (built on @hiero-ledger/sdk), so the serialized bytes
 * are exactly what the Blocky402 facilitator decodes — no cross-SDK byte drift.
 * See scripts/probe-x402.ts for the live verify/settle round-trip.
 */
import { createClientHederaSigner, PrivateKey, HBAR_ASSET_ID } from '@x402/hedera';

export { HBAR_ASSET_ID }; // "0.0.0" — x402's asset id for native HBAR

export interface HederaPayerConfig {
  payerAccountId: string; // the buyer's Hedera account (charged the transfer)
  payerKeyHex: string; // the buyer's ECDSA key, hex with or without 0x
  network?: string; // CAIP-2: "hedera:testnet" (default) | "hedera:mainnet"
}

export interface HederaPaymentReq {
  amount: string; // price in base units (tinybars for HBAR, token units otherwise)
  payTo: string; // the service account that receives the payment
  asset: string; // HBAR_ASSET_ID ("0.0.0") for HBAR, else an HTS token id
  feePayer: string; // the facilitator's account (pays the network fee)
  resource?: string; // the route being paid for
}

/** Build the base64 `payload.transaction`: a partially-signed Hedera transfer. */
export async function buildHederaPayment(req: HederaPaymentReq, cfg: HederaPayerConfig): Promise<string> {
  const network = cfg.network ?? 'hedera:testnet';
  const hex = cfg.payerKeyHex.startsWith('0x') ? cfg.payerKeyHex.slice(2) : cfg.payerKeyHex;
  const signer = createClientHederaSigner(cfg.payerAccountId, PrivateKey.fromStringECDSA(hex), { network });
  // createPartiallySignedTransferTransaction reads scheme/network/asset/amount/payTo/extra.feePayer.
  return signer.createPartiallySignedTransferTransaction({
    scheme: 'exact',
    network,
    asset: req.asset,
    amount: req.amount,
    payTo: req.payTo,
    resource: req.resource ?? '/score',
    description: 'Assay credit score',
    mimeType: 'application/json',
    maxTimeoutSeconds: 60,
    extra: { feePayer: req.feePayer },
  } as Parameters<typeof signer.createPartiallySignedTransferTransaction>[0]);
}
