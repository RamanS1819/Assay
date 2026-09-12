/**
 * Live x402 wiring — assembles the gateway config, the Blocky402 facilitator client,
 * and the buyer-side payment builder from env. Keeps lib/gateway/x402.ts pure (all
 * three are injected) while giving the /score route and the buy-score script one
 * place to read the environment.
 */
import { httpFacilitator, type GatewayConfig, type FacilitatorClient, type PaymentRequirement } from '../gateway/x402';
import { buildHederaPayment, HBAR_ASSET_ID } from './hedera-payment';

/** The paywall's requirements: who gets paid, in what asset, who covers the fee. */
export function makeGatewayConfig(): GatewayConfig {
  const payTo = process.env.X402_PAY_TO;
  if (!payTo) throw new Error('X402_PAY_TO not set (the service account that receives payments)');
  // X402_ASSET may still say "HBAR" in older .env files; native HBAR is asset id 0.0.0.
  const rawAsset = process.env.X402_ASSET;
  const asset = !rawAsset || rawAsset === 'HBAR' ? HBAR_ASSET_ID : rawAsset;
  return {
    network: 'hedera:testnet',
    asset,
    payTo,
    feePayer: process.env.X402_FEE_PAYER ?? '0.0.7162784',
    maxTimeoutSeconds: 60,
  };
}

/** The Blocky402 facilitator (verify + settle over HTTP). */
export function makeFacilitator(): FacilitatorClient {
  const url = process.env.BLOCKY402_FACILITATOR_URL;
  if (!url) throw new Error('BLOCKY402_FACILITATOR_URL not set');
  return httpFacilitator(url);
}

/**
 * Buyer side: turn a PaymentRequirement into the base64 PAYMENT-SIGNATURE payload.
 * The buyer signs with its Hedera key (HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY).
 */
export function makeBuyerPaymentBuilder(): (r: PaymentRequirement) => Promise<string> {
  const payerAccountId = process.env.HEDERA_ACCOUNT_ID;
  const payerKeyHex = process.env.HEDERA_PRIVATE_KEY;
  if (!payerAccountId || !payerKeyHex) throw new Error('HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY not set (the buyer)');
  return async (r) => {
    const transaction = await buildHederaPayment(
      { amount: r.amount, payTo: r.payTo, asset: r.asset, feePayer: r.extra.feePayer },
      { payerAccountId, payerKeyHex, network: r.network },
    );
    const paymentPayload = { x402Version: 2, accepted: r, payload: { transaction } };
    return Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  };
}
