/**
 * Pure mapping: raw source data -> ScoreInputs (what the deterministic model eats).
 * No network here. Fully unit-tested.
 */
import type { ScoreInputs } from '../types/index';
import type { RawLendingData, RawPortfolio, CounterpartyData } from './sources';

/** balances[] -> aggregate portfolio facts (total, stablecoin ratio inputs, concentration). */
export function aggregatePortfolio(balances: RawPortfolio): ScoreInputs['portfolio'] {
  const positive = balances.filter((b) => b.valueUsd > 0);
  const totalUsd = positive.reduce((a, b) => a + b.valueUsd, 0);
  const stablecoinUsd = positive.filter((b) => b.isStablecoin).reduce((a, b) => a + b.valueUsd, 0);
  const largestPositionUsd = positive.reduce((m, b) => Math.max(m, b.valueUsd), 0);
  return { totalUsd, stablecoinUsd, largestPositionUsd, positionCount: positive.length };
}

export interface MapArgs {
  lending: RawLendingData;
  portfolio: RawPortfolio;
  counterparty?: CounterpartyData;
  balanceStdDevPct?: number;
}

export function toScoreInputs(args: MapArgs): ScoreInputs {
  const { lending, portfolio, counterparty, balanceStdDevPct } = args;
  return {
    accountMaturity: {
      // No lending history -> treated as a new, unproven borrower (age 0). For a
      // credit bureau that is the right default: no track record = low maturity.
      firstSeenBlock: lending.firstActivityBlock ?? lending.currentBlock,
      currentBlock: lending.currentBlock,
      activeDays: lending.activeDays,
      txCount: lending.txCount,
    },
    portfolio: aggregatePortfolio(portfolio),
    leverage: {
      openBorrowsUsd: lending.openBorrowsUsd,
      collateralUsd: lending.collateralUsd,
      minHealthFactor: lending.minHealthFactor,
      liquidationCount: lending.liquidationCount,
    },
    counterparty: counterparty ?? { flaggedInteractionCount: 0, totalCounterparties: 0 },
    volatility: { balanceStdDevPct: balanceStdDevPct ?? 0 },
  };
}

/** Which data sources actually contributed — stamped onto the Score for explainability. */
export function contributingSources(args: MapArgs): string[] {
  const s = ['messari-lending', 'token-api'];
  if (args.counterparty) s.push('counterparty');
  if (args.balanceStdDevPct !== undefined) s.push('volatility');
  return s;
}
