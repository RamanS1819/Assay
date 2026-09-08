import { describe, it, expect, vi } from 'vitest';
import { gate, build402, encodeRequired, decodeRequired, decodePayment, requirementFor, type FacilitatorClient, type GatewayConfig, type RoutePrice } from './x402';

const cfg: GatewayConfig = { network: 'hedera-testnet', asset: '0.0.429274', payTo: '0.0.1234' };
const route: RoutePrice = { resource: '/score', maxAmountRequired: '2000' };

function facilitator(over: Partial<FacilitatorClient> = {}): FacilitatorClient {
  return {
    verify: vi.fn(async () => ({ isValid: true })),
    settle: vi.fn(async () => ({ txHash: '0xhash' })),
    ...over,
  };
}

describe('encode/decode', () => {
  it('round-trips a PaymentRequired body', () => {
    const { body } = build402(route, cfg);
    expect(decodeRequired(encodeRequired(body))).toEqual(body);
  });
  it('requirementFor carries the price, asset, network and resource', () => {
    expect(requirementFor(route, cfg)).toEqual({
      scheme: 'exact', network: 'hedera-testnet', asset: '0.0.429274', maxAmountRequired: '2000', payTo: '0.0.1234', resource: '/score',
    });
  });
});

describe('gate', () => {
  it('returns 402 with a PAYMENT-REQUIRED header when no payment is presented', async () => {
    const f = facilitator();
    const r = await gate(null, route, cfg, f);
    expect(r.status).toBe(402);
    expect(r.ok).toBe(false);
    if (r.status === 402) {
      const decoded = decodeRequired(r.requiredHeader);
      expect(decoded.accepts[0].maxAmountRequired).toBe('2000');
    }
    expect(f.verify).not.toHaveBeenCalled();
  });

  it('returns 400 on a malformed payment header', async () => {
    const r = await gate('%%%not-base64-json%%%', route, cfg, facilitator());
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 402 again when the facilitator says the payment is invalid', async () => {
    const f = facilitator({ verify: vi.fn(async () => ({ isValid: false, reason: 'underpaid' })) });
    const header = Buffer.from(JSON.stringify({ some: 'payload' })).toString('base64');
    const r = await gate(header, route, cfg, f);
    expect(r).toMatchObject({ ok: false, status: 402, reason: 'underpaid' });
    expect(f.settle).not.toHaveBeenCalled();
  });

  it('verifies then settles and returns 200 + txHash on a valid payment', async () => {
    const f = facilitator();
    const header = Buffer.from(JSON.stringify({ some: 'payload' })).toString('base64');
    const r = await gate(header, route, cfg, f);
    expect(r).toEqual({ ok: true, status: 200, txHash: '0xhash' });
    expect(f.verify).toHaveBeenCalledOnce();
    expect(f.settle).toHaveBeenCalledOnce();
  });
});

describe('decodePayment', () => {
  it('parses a base64 JSON payload', () => {
    const header = Buffer.from(JSON.stringify({ a: 1 })).toString('base64');
    expect(decodePayment(header)).toEqual({ a: 1 });
  });
});
