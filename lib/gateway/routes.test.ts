import { describe, it, expect } from 'vitest';
import { schemaResponse, healthResponse, PRICED_ROUTES, SIGNALS } from './routes';
import { MODEL_VERSION } from '../scorer/model';

describe('schemaResponse', () => {
  it('lists five signals whose weights sum to 1 and stamps the model version', () => {
    const s = schemaResponse();
    expect(s.modelVersion).toBe(MODEL_VERSION);
    expect(s.signals).toHaveLength(5);
    const sum = s.signals.reduce((a, sig) => a + sig.weight, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
  it('states plainly that the LLM does not compute the score', () => {
    expect(schemaResponse().note).toMatch(/LLM does not compute/i);
  });
});

describe('healthResponse', () => {
  it('reports indexing state and last block', () => {
    const h = healthResponse({ lastBlock: 12345, indexingOk: true });
    expect(h).toMatchObject({ ok: true, lastBlock: 12345 });
    expect(typeof h.at).toBe('string');
  });
});

describe('PRICED_ROUTES', () => {
  it('prices score, batch and watch in tinybars', () => {
    expect(PRICED_ROUTES.score.amount).toBe('100000');
    expect(PRICED_ROUTES.batch.amount).toBe('25000');
    expect(PRICED_ROUTES.watch.amount).toBe('1000000');
  });
  it('exposes the same signal keys as the scorer', () => {
    expect(SIGNALS.map((s) => s.key)).toEqual([
      'accountMaturity', 'portfolioQuality', 'leverageHistory', 'counterpartyHygiene', 'recentVolatility',
    ]);
  });
});
