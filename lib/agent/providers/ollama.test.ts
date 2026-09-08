import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from './ollama';
import type { UnderwriteRequest } from '../underwrite';
import type { Score, Policy } from '../../types/index';

function score(value = 65): Score {
  return {
    address: '0xabc', chain: 'ethereum', value,
    subscores: { accountMaturity: 50, portfolioQuality: 50, leverageHistory: value, counterpartyHygiene: 80, recentVolatility: 70 },
    weights: { accountMaturity: 0.15, portfolioQuality: 0.25, leverageHistory: 0.3, counterpartyHygiene: 0.2, recentVolatility: 0.1 },
    asOfBlock: 500, computedAt: 'T', inputs: [], modelVersion: '1.0.0',
  };
}
const policy: Policy = { perRequestCapUsd: 0.05, dailyCapUsd: 5, quorumThresholdUnits: 10000, quorumRequired: 2, quorumSigners: 3 };
const req: UnderwriteRequest = { score: score(), exposureUnits: 0, requestedUnits: 5000, policy, maxLimitUnits: 100000 };

describe('OllamaProvider', () => {
  it('parses an OpenAI-compatible local response', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"limit": 2500, "rationale": "moderate"}' } }] }),
    })) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://localhost:11434/v1/chat/completions', 'llama3.1', fetchFn);
    expect(await provider.underwrite(req)).toEqual({ limit: 2500, rationale: 'moderate' });
  });

  it('posts to the configured url with no auth header', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"limit":0,"rationale":"x"}' } }] }) })) as unknown as typeof fetch;
    await new OllamaProvider('http://host:1234/v1/chat/completions', 'm', fetchFn).underwrite(req);
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://host:1234/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('throws on a non-ok response so failover can move on', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(new OllamaProvider('u', 'm', fetchFn).underwrite(req)).rejects.toThrow('Ollama failed: 500');
  });
});
