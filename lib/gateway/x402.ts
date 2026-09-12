/**
 * x402 gateway logic — framework-agnostic and testable. A Next.js route (or an
 * Express handler) is a thin adapter that calls `gate()` and maps GateResult to
 * an HTTP response. Follows the x402 v2 flow settled by Blocky402 on Hedera:
 *
 *   no PAYMENT-SIGNATURE ─────▶ 402 + PAYMENT-REQUIRED header (the accepts[] requirements)
 *   PAYMENT-SIGNATURE present ─▶ facilitator.verify -> facilitator.settle -> 200 + txId
 *
 * The facilitator is Blocky402; it adds the fee-payer signature, broadcasts, and
 * pays gas. We never hold funds; we only verify + trigger settlement. Field shapes
 * (v2: `amount`, `extra.feePayer`, payload carries `accepted`) are verified against
 * the live facilitator — see scripts/probe-x402.ts and lib/live/hedera-payment.ts.
 */
export const X402_VERSION = 2;

export interface PaymentRequirement {
  scheme: string; // "exact"
  network: string; // "hedera:testnet"
  amount: string; // price in the asset's base units (tinybars for HBAR)
  asset: string; // "0.0.0" for native HBAR, else an HTS token id
  payTo: string; // service account that receives the payment
  maxTimeoutSeconds: number;
  extra: { feePayer: string } & Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: number;
  accepts: PaymentRequirement[];
}

/** The payload the buyer sends back in the PAYMENT-SIGNATURE header (base64 JSON). */
export interface PaymentPayload {
  x402Version: number;
  accepted: PaymentRequirement; // the chosen requirement (v2 carries it here, not scheme/network)
  payload: { transaction: string }; // base64 partially-signed Hedera tx
}

export interface GatewayConfig {
  network: string; // "hedera:testnet"
  asset: string; // "0.0.0"
  payTo: string; // service account
  feePayer: string; // facilitator account (0.0.7162784)
  maxTimeoutSeconds?: number; // default 60
}

export interface RoutePrice {
  resource: string;
  amount: string; // base units, e.g. "100000" tinybars
}

const b64encode = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const b64decode = (s: string) => Buffer.from(s, 'base64').toString('utf8');

export function encodeRequired(pr: PaymentRequired): string {
  return b64encode(JSON.stringify(pr));
}
export function decodeRequired(header: string): PaymentRequired {
  return JSON.parse(b64decode(header));
}
export function decodePayment(header: string): PaymentPayload {
  return JSON.parse(b64decode(header));
}

export function requirementFor(route: RoutePrice, cfg: GatewayConfig): PaymentRequirement {
  return {
    scheme: 'exact',
    network: cfg.network,
    amount: route.amount,
    asset: cfg.asset,
    payTo: cfg.payTo,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds ?? 60,
    extra: { feePayer: cfg.feePayer },
  };
}

export function build402(route: RoutePrice, cfg: GatewayConfig): { header: string; body: PaymentRequired } {
  const body: PaymentRequired = { x402Version: X402_VERSION, accepts: [requirementFor(route, cfg)] };
  return { header: encodeRequired(body), body };
}

export interface VerifyResult {
  isValid: boolean;
  reason?: string;
}

export interface SettleResult {
  txHash: string; // Hedera tx id "0.0.X@sec.nanos"
}

export interface FacilitatorClient {
  verify(payload: PaymentPayload, requirement: PaymentRequirement): Promise<VerifyResult>;
  settle(payload: PaymentPayload, requirement: PaymentRequirement): Promise<SettleResult>;
}

/** Real Blocky402 client. Not unit-tested (needs the live facilitator); gate() is. */
export function httpFacilitator(baseUrl: string, fetchFn: typeof fetch = fetch): FacilitatorClient {
  const post = async (path: string, payload: PaymentPayload, requirement: PaymentRequirement) => {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirement }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`facilitator ${path} failed (${res.status}): ${JSON.stringify(data)}`);
    return data;
  };
  return {
    async verify(payload, requirement) {
      const d = await post('/verify', payload, requirement);
      return { isValid: Boolean(d.isValid), reason: (d.invalidReason as string) ?? (d.invalidMessage as string) };
    },
    async settle(payload, requirement) {
      const d = await post('/settle', payload, requirement);
      if (!d.success) throw new Error(`settle rejected: ${(d.errorReason as string) ?? 'unknown'}`);
      return { txHash: String(d.transaction) };
    },
  };
}

export type GateResult =
  | { ok: false; status: 402; requiredHeader: string; reason?: string }
  | { ok: false; status: 400; reason: string }
  | { ok: true; status: 200; txHash: string };

/**
 * The paywall decision for one priced request.
 * @param paymentHeader the incoming PAYMENT-SIGNATURE header (or null if absent)
 */
export async function gate(
  paymentHeader: string | null,
  route: RoutePrice,
  cfg: GatewayConfig,
  facilitator: FacilitatorClient,
): Promise<GateResult> {
  const { header, body } = build402(route, cfg);
  const requirement = body.accepts[0];

  if (!paymentHeader) {
    return { ok: false, status: 402, requiredHeader: header };
  }

  let payload: PaymentPayload;
  try {
    payload = decodePayment(paymentHeader);
  } catch {
    return { ok: false, status: 400, reason: 'malformed PAYMENT-SIGNATURE header' };
  }

  const verified = await facilitator.verify(payload, requirement);
  if (!verified.isValid) {
    return { ok: false, status: 402, requiredHeader: header, reason: verified.reason ?? 'payment invalid' };
  }

  const settled = await facilitator.settle(payload, requirement);
  return { ok: true, status: 200, txHash: settled.txHash };
}
