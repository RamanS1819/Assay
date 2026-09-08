import { describe, it, expect, vi } from 'vitest';
import { GeminiProvider } from './gemini';
import type { UnderwriteRequest } from '../underwrite';
import type { Score, Policy } from '../../types/index';

function score(value = 68): Score {
  return {
    address: '0xabc', chain: 'ethereum', value,
    subscores: { accountMaturity: 55, portfolioQuality: 60, leverageHistory: value, counterpartyHygiene: 85, recentVolatility: 75 },
    weights: { accountMaturity: 0.15, portfolioQuality: 0.25, leverageHistory: 0.3, counterpartyHygiene: 0.2, recentVolatility: 0.1 },
    asOfBlock: 500, computedAt: 'T', inputs: [], modelVersion: '1.0.0',
  };
}
const policy: Policy = { perRequestCapUsd: 0.05, dailyCapUsd: 5, quorumThresholdUnits: 10000, quorumRequired: 2, quorumSigners: 3 };
const req: UnderwriteRequest = { score: score(), exposureUnits: 0, requestedUnits: 5000, policy, maxLimitUnits: 100000 };

describe('GeminiProvider', () => {
  it('parses a generateContent response', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"limit": 3300, "rationale": "steady"}' }] } }] }),
    })) as unknown as typeof fetch;
    const provider = new GeminiProvider('test-key', 'gemini-1.5-flash', fetchFn);
    expect(await provider.underwrite(req)).toEqual({ limit: 3300, rationale: 'steady' });
  });

  it('sends the prompt as systemInstruction + user contents', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"limit":0,"rationale":"x"}' }] } }] }) })) as unknown as typeof fetch;
    await new GeminiProvider('k', 'gemini-1.5-flash', fetchFn).underwrite(req);
    const body = JSON.parse((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toMatch(/credit underwriter/i);
    expect(body.contents[0].role).toBe('user');
    expect(JSON.parse(body.contents[0].parts[0].text)).toMatchObject({ score: 68 });
  });

  it('throws without an API key', async () => {
    await expect(new GeminiProvider('', undefined, vi.fn() as unknown as typeof fetch).underwrite(req)).rejects.toThrow('GEMINI_API_KEY');
  });

  it('throws on a non-ok response so failover moves on', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(new GeminiProvider('k', undefined, fetchFn).underwrite(req)).rejects.toThrow('Gemini failed: 503');
  });
});
