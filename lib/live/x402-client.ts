/**
 * Agent-side x402 client — the 402 -> pay -> retry dance.
 *
 *   GET /score/:addr
 *     └─ 402 + PAYMENT-REQUIRED header ─▶ decode requirement
 *                                          └─ buildPayment(requirement)  (sign the payment)
 *                                             └─ retry with PAYMENT-SIGNATURE header
 *                                                └─ 200 + score  (+ settlement tx hash)
 *
 * This orchestration is framework-agnostic and unit-tested with a mock fetch. The
 * `buildPayment` function — which constructs and signs the actual payment payload —
 * is INJECTED, because its exact shape depends on the live Blocky402 facilitator
 * (see the PaymentBuilder note below). That is the one x402 piece that needs a live
 * probe (plan §2C, Path A vs B).
 */
import { decodeRequired, type PaymentRequirement } from '../gateway/x402';

/**
 * Builds the base64 PAYMENT-SIGNATURE payload for a given requirement, signing with
 * the agent's Privy wallet. Two implementations are possible, decided by one live
 * check against Blocky402 (they were unreachable at build time):
 *
 *   Path A (EVM `exact` scheme, USDC): an EIP-3009 transferWithAuthorization signed
 *     via privy.walletApi.ethereum.signTypedData — fully Privy-native, no extra deps.
 *   Path B (Hedera-native, HBAR): a partially-signed TransferTransaction built with
 *     @hashgraph/sdk, raw-signed via privy.walletApi.ethereum.secp256k1Sign.
 *
 * Whichever the facilitator accepts, it plugs in here unchanged.
 */
export type PaymentBuilder = (requirement: PaymentRequirement) => Promise<string>;

export interface X402Result<T> {
  data: T;
  requirement?: PaymentRequirement;
  paymentTxHash?: string;
}

const HDR_REQUIRED = 'payment-required';
const HDR_SIGNATURE = 'payment-signature';
const HDR_RESPONSE = 'x-payment-response'; // settlement info; exact key/shape confirmed on live probe

function extractTxHash(res: Response): string | undefined {
  const h = res.headers.get(HDR_RESPONSE);
  if (!h) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    return decoded.txHash ?? decoded.transaction ?? decoded.hash ?? undefined;
  } catch {
    return h;
  }
}

export async function x402Fetch<T = unknown>(
  url: string,
  buildPayment: PaymentBuilder,
  fetchFn: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<X402Result<T>> {
  const first = await fetchFn(url, init);

  // Free route, or already satisfied — nothing to pay.
  if (first.status !== 402) {
    if (!first.ok) throw new Error(`x402 request failed: ${first.status}`);
    return { data: (await first.json()) as T };
  }

  const requiredHeader = first.headers.get(HDR_REQUIRED);
  if (!requiredHeader) throw new Error('402 response is missing the PAYMENT-REQUIRED header');
  const requirement = decodeRequired(requiredHeader).accepts[0];

  const payment = await buildPayment(requirement);

  const paid = await fetchFn(url, {
    ...init,
    headers: { ...(init.headers ?? {}), [HDR_SIGNATURE]: payment },
  });
  if (!paid.ok) throw new Error(`x402 paid request failed: ${paid.status}`);

  return {
    data: (await paid.json()) as T,
    requirement,
    paymentTxHash: extractTxHash(paid),
  };
}
