/**
 * x402 gateway logic — framework-agnostic and testable. A Next.js route (or an
 * Express handler) is a thin adapter that calls `gate()` and maps GateResult to
 * an HTTP response. Follows the x402 flow (plan §2C):
 *
 *   no PAYMENT-SIGNATURE ─────▶ 402 + PAYMENT-REQUIRED header
 *   PAYMENT-SIGNATURE present ─▶ facilitator.verify -> facilitator.settle -> 200 + txHash
 *
 * The facilitator is Blocky402 on Hedera; it broadcasts + pays gas (partial-sign).
 * We never hold funds; we only verify + trigger settlement.
 */

export interface PaymentRequirement {
  scheme: string; // "exact"
  network: string; // "hedera-testnet"
  asset: string; // settlement token (e.g. USDC HTS id)
  maxAmountRequired: string; // price in asset base units
  payTo: string; // service account
  resource: string; // the route being paid for
}

export interface PaymentRequired {
  accepts: PaymentRequirement[];
}

export interface GatewayConfig {
  network: string;
  asset: string;
  payTo: string;
}

export interface RoutePrice {
  resource: string;
  maxAmountRequired: string; // asset base units, e.g. "2000" = $0.002 of 6-decimal USDC
}

const b64encode = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const b64decode = (s: string) => Buffer.from(s, 'base64').toString('utf8');

export function encodeRequired(pr: PaymentRequired): string {
  return b64encode(JSON.stringify(pr));
}
export function decodeRequired(header: string): PaymentRequired {
  return JSON.parse(b64decode(header));
}
export function decodePayment(header: string): unknown {
  return JSON.parse(b64decode(header));
}

export function requirementFor(route: RoutePrice, cfg: GatewayConfig): PaymentRequirement {
  return {
    scheme: 'exact',
    network: cfg.network,
    asset: cfg.asset,
    maxAmountRequired: route.maxAmountRequired,
    payTo: cfg.payTo,
    resource: route.resource,
  };
}

export function build402(route: RoutePrice, cfg: GatewayConfig): { header: string; body: PaymentRequired } {
  const body: PaymentRequired = { accepts: [requirementFor(route, cfg)] };
  return { header: encodeRequired(body), body };
}

export interface VerifyResult {
  isValid: boolean;
  reason?: string;
}

export interface SettleResult {
  txHash: string;
}

export interface FacilitatorClient {
  verify(payload: unknown, requirement: PaymentRequirement): Promise<VerifyResult>;
  settle(payload: unknown, requirement: PaymentRequirement): Promise<SettleResult>;
}

/** Real Blocky402 client. Not unit-tested (needs the live facilitator); gate() is. */
export function httpFacilitator(baseUrl: string, fetchFn: typeof fetch = fetch): FacilitatorClient {
  const post = async (path: string, body: unknown) => {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`facilitator ${path} failed: ${res.status}`);
    return res.json();
  };
  return {
    async verify(payload, requirement) {
      return (await post('/verify', { paymentPayload: payload, paymentRequirements: requirement })) as VerifyResult;
    },
    async settle(payload, requirement) {
      return (await post('/settle', { paymentPayload: payload, paymentRequirements: requirement })) as SettleResult;
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

  let payload: unknown;
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
