import { describe, it, expect, vi } from 'vitest';
import { buildMessages, parseContent, GroqProvider, makeUnderwriteProvider } from './groq';
import type { UnderwriteRequest } from '../underwrite';
import type { Score, Policy } from '../../types/index';

function score(value = 70): Score {
  return {
    address: '0xabc', chain: 'ethereum', value,
    subscores: { accountMaturity: 60, portfolioQuality: 55, leverageHistory: value, counterpartyHygiene: 90, recentVolatility: 80 },
    weights: { accountMaturity: 0.15, portfolioQuality: 0.25, leverageHistory: 0.3, counterpartyHygiene: 0.2, recentVolatility: 0.1 },
    asOfBlock: 500, computedAt: 'T', inputs: [], modelVersion: '1.0.0',
  };
}
const policy: Policy = { perRequestCapUsd: 0.05, dailyCapUsd: 5, quorumThresholdUnits: 10000, quorumRequired: 2, quorumSigners: 3 };
const req: UnderwriteRequest = { score: score(70), exposureUnits: 0, requestedUnits: 5000, policy, maxLimitUnits: 100000 };

describe('buildMessages', () => {
  it('includes the JSON instruction and the score facts', () => {
    const [system, user] = buildMessages(req);
    expect(system.content).toMatch(/Return ONLY a JSON object/);
    expect(JSON.parse(user.content)).toMatchObject({ score: 70, maxLimitUnits: 100000, quorumThresholdUnits: 10000 });
  });
});

describe('parseContent', () => {
  it('parses a plain JSON object', () => {
    expect(parseContent('{"limit": 3000, "rationale": "solid"}')).toEqual({ limit: 3000, rationale: 'solid' });
  });
  it('strips ```json fences', () => {
    expect(parseContent('```json\n{"limit": 1, "rationale": "x"}\n```')).toEqual({ limit: 1, rationale: 'x' });
  });
  it('throws on non-JSON so the caller falls back', () => {
    expect(() => parseContent('sorry, I cannot help with that')).toThrow();
  });
});

describe('GroqProvider.underwrite', () => {
  it('parses a Groq-shaped response', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"limit": 4200, "rationale": "good leverage history"}' } }] }),
    })) as unknown as typeof fetch;
    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile', fetchFn);
    expect(await provider.underwrite(req)).toEqual({ limit: 4200, rationale: 'good leverage history' });
  });

  it('throws without an API key', async () => {
    await expect(new GroqProvider('', undefined, vi.fn() as unknown as typeof fetch).underwrite(req)).rejects.toThrow('GROQ_API_KEY');
  });

  it('throws on a non-ok response (loop then falls back to the deterministic baseline)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(new GroqProvider('k', undefined, fetchFn).underwrite(req)).rejects.toThrow('Groq failed: 429');
  });
});

describe('makeUnderwriteProvider', () => {
  it('returns a Groq provider by default', () => {
    expect(makeUnderwriteProvider('groq')).toBeInstanceOf(GroqProvider);
  });
  it('rejects an unimplemented provider', () => {
    expect(() => makeUnderwriteProvider('gemini')).toThrow(/not implemented/);
  });
});
