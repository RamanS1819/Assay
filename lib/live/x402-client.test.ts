import { describe, it, expect, vi } from 'vitest';
import { x402Fetch, type PaymentBuilder } from './x402-client';
import { build402, type GatewayConfig, type RoutePrice } from '../gateway/x402';

const cfg: GatewayConfig = { network: 'hedera:testnet', asset: '0.0.0', payTo: '0.0.1234', feePayer: '0.0.7162784' };
const route: RoutePrice = { resource: '/score', amount: '100000' };

function res(init: { status: number; headers?: Record<string, string>; body?: unknown }): Response {
  return {
    status: init.status,
    ok: init.status >= 200 && init.status < 300,
    headers: new Headers(init.headers ?? {}),
    json: async () => init.body ?? {},
  } as unknown as Response;
}

/** A fake payment builder that records the requirement it was handed. */
function builder(): { fn: PaymentBuilder; seen: PaymentRequirementSeen } {
  const seen: PaymentRequirementSeen = {};
  const fn = vi.fn(async (r) => {
    seen.requirement = r;
    return 'BASE64_SIGNED_PAYMENT';
  });
  return { fn, seen };
}
interface PaymentRequirementSeen {
  requirement?: { amount: string; asset: string };
}

describe('x402Fetch', () => {
  it('pays on a 402, retries with PAYMENT-SIGNATURE, and returns the data', async () => {
    const { header } = build402(route, cfg);
    const settleHeader = Buffer.from(JSON.stringify({ txHash: '0xsettled' })).toString('base64');

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(res({ status: 402, headers: { 'PAYMENT-REQUIRED': header } }))
      .mockResolvedValueOnce(res({ status: 200, headers: { 'X-PAYMENT-RESPONSE': settleHeader }, body: { value: 72 } })) as unknown as typeof fetch;

    const b = builder();
    const out = await x402Fetch<{ value: number }>('http://svc/score/0xabc', b.fn, fetchFn);

    expect(out.data).toEqual({ value: 72 });
    expect(out.paymentTxHash).toBe('0xsettled');
    expect(b.seen.requirement?.amount).toBe('100000');
    // second call carried the payment header
    const secondInit = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(secondInit.headers['payment-signature']).toBe('BASE64_SIGNED_PAYMENT');
  });

  it('returns immediately for a free (non-402) route without building a payment', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res({ status: 200, body: { ok: true } })) as unknown as typeof fetch;
    const b = builder();
    const out = await x402Fetch('http://svc/health', b.fn, fetchFn);
    expect(out.data).toEqual({ ok: true });
    expect(b.fn).not.toHaveBeenCalled();
  });

  it('throws on a 402 with no PAYMENT-REQUIRED header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res({ status: 402 })) as unknown as typeof fetch;
    await expect(x402Fetch('http://svc/score/0x', builder().fn, fetchFn)).rejects.toThrow(/PAYMENT-REQUIRED/);
  });

  it('throws if the paid retry fails', async () => {
    const { header } = build402(route, cfg);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(res({ status: 402, headers: { 'PAYMENT-REQUIRED': header } }))
      .mockResolvedValueOnce(res({ status: 500 })) as unknown as typeof fetch;
    await expect(x402Fetch('http://svc/score/0x', builder().fn, fetchFn)).rejects.toThrow(/failed: 500/);
  });
});
