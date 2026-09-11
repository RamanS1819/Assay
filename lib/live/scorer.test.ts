import { describe, it, expect } from 'vitest';
import { NEUTRAL_PORTFOLIO } from './scorer';
import { aggregatePortfolio } from '../scorer/map';
import { normalizePortfolioQuality } from '../scorer/model';

describe('NEUTRAL_PORTFOLIO', () => {
  it('resolves to a neutral portfolio quality of ~50 so an absent Token API does not drag the score', () => {
    const agg = aggregatePortfolio(NEUTRAL_PORTFOLIO);
    expect(normalizePortfolioQuality(agg)).toBe(50);
  });
});
