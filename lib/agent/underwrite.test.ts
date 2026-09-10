import { describe, it, expect, vi } from 'vitest';
import { underwrite, fallbackUnderwrite, type UnderwriteRequest } from './underwrite';
import type { Score, Policy } from '../types/index';

function score(value: number, address = '0xabc'): Score {
  return {
    address, chain: 'ethereum', value,
    subscores: { accountMaturity: 60, portfolioQuality: 55, leverageHistory: value, counterpartyHygiene: 90, recentVolatility: 80 },
    weights: { accountMaturity: 0.15, portfolioQuality: 0.25, leverageHistory: 0.3, counterpartyHygiene: 0.2, recentVolatility: 0.1 },
    asOfBlock: 500, computedAt: '2026-09-06T00:00:00.000Z', inputs: ['messari-lending', 'token-api'], modelVersion: '1.0.0',
  };
}
const policy: Policy = { perRequestCapUsd: 0.05, dailyCapUsd: 5, quorumThresholdUnits: 10000, quorumRequired: 2, quorumSigners: 3 };
function req(value: number, exposureUnits = 0): UnderwriteRequest {
  return { score: score(value), exposureUnits, requestedUnits: 5000, policy, maxLimitUnits: 100000 };
}

describe('fallbackUnderwrite', () => {
  it('denies below the floor, scales above it', () => {
    expect(fallbackUnderwrite(req(30)).limit).toBe(0);
    expect(fallbackUnderwrite(req(70)).limit).toBe(50000);
  });
});

describe('underwrite', () => {
  it('uses the deterministic fallback with no provider', async () => {
    const d = await underwrite(req(70));
    expect(d.limit).toBe(50000);
    expect(d.escalated).toBe(true); // 50000 > 10000 threshold
  });

  it('uses a valid provider result', async () => {
    const provider = { underwrite: vi.fn(async () => ({ limit: 3000, rationale: 'solid history' })) };
    const d = await underwrite(req(70), provider);
    expect(d.limit).toBe(3000);
    expect(d.escalated).toBe(false);
  });

  it('CLAMPS a provider limit above the max — never over-issue', async () => {
    const provider = { underwrite: vi.fn(async () => ({ limit: 999_999_999, rationale: 'trust me' })) };
    const d = await underwrite(req(70), provider);
    expect(d.limit).toBe(100000);
  });

  it('falls back deterministically when the provider throws', async () => {
    const provider = { underwrite: vi.fn(async () => { throw new Error('groq down'); }) };
    expect((await underwrite(req(70), provider)).limit).toBe(50000);
  });

  it('revokes a denied small holder autonomously (no escalation)', async () => {
    const d = await underwrite(req(30, 5000)); // holds 5000 < 10000 threshold
    expect(d.limit).toBe(0);
    expect(d.revokes).toBe(true);
    expect(d.escalated).toBe(false);
  });

  it('escalates the revocation of a denied large holder', async () => {
    const d = await underwrite(req(30, 50_000));
    expect(d.revokes).toBe(true);
    expect(d.escalated).toBe(true);
  });

  it('does not revoke a non-holder that is denied', async () => {
    const d = await underwrite(req(30, 0));
    expect(d.revokes).toBe(false);
    expect(d.escalated).toBe(false);
  });

  it('revokes a current holder whose score drops below the maintenance floor', async () => {
    const d = await underwrite(req(46, 3000)); // score 46 < 50, holds 3000 units
    expect(d.revokes).toBe(true);
    expect(d.limit).toBe(0); // line pulled even though the raw score would allow > 0
  });

  it('keeps a healthy holder above the floor', async () => {
    const d = await underwrite(req(70, 3000));
    expect(d.revokes).toBe(false);
    expect(d.limit).toBeGreaterThan(0);
  });

  it('bounds a runaway rationale to 500 chars', async () => {
    const provider = { underwrite: vi.fn(async () => ({ limit: 1000, rationale: 'x'.repeat(9999) })) };
    expect((await underwrite(req(70), provider)).rationale.length).toBe(500);
  });
});
