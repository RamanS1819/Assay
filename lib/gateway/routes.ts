/**
 * The API surface (plan §10). Two free routes so a judge can poke without a wallet;
 * three priced. Prices are in the settlement asset's base units (USDC = 6 decimals),
 * deliberately absurd next to the losses a bad counterparty causes.
 */
import type { RoutePrice } from './x402';
import { WEIGHTS, MODEL_VERSION } from '../scorer/model';

export const PRICED_ROUTES: Record<'score' | 'batch' | 'watch', RoutePrice> = {
  score: { resource: '/score', maxAmountRequired: '2000' }, // $0.002
  batch: { resource: '/score/batch', maxAmountRequired: '500' }, // $0.0005 each
  watch: { resource: '/watch', maxAmountRequired: '20000' }, // $0.02 / hr
};

export interface SignalDef {
  key: string;
  weight: number;
  description: string;
}

export const SIGNALS: SignalDef[] = [
  { key: 'accountMaturity', weight: WEIGHTS.accountMaturity, description: 'first lending activity, active days, tx cadence' },
  { key: 'portfolioQuality', weight: WEIGHTS.portfolioQuality, description: 'holdings mix, stablecoin ratio, concentration' },
  { key: 'leverageHistory', weight: WEIGHTS.leverageHistory, description: 'open borrows, health factor, past liquidations' },
  { key: 'counterpartyHygiene', weight: WEIGHTS.counterpartyHygiene, description: 'interactions with flagged addresses' },
  { key: 'recentVolatility', weight: WEIGHTS.recentVolatility, description: 'balance swings since the last poll' },
];

/** Free `GET /schema`: signal definitions, weights, model version — the "why" behind a score. */
export function schemaResponse() {
  return {
    modelVersion: MODEL_VERSION,
    scoreRange: [0, 100] as const,
    signals: SIGNALS,
    note: 'The LLM does not compute the score; this model is deterministic and recomputable.',
  };
}

/** Free `GET /health`: indexing state so a caller knows how fresh the data is. */
export function healthResponse(status: { lastBlock: number; indexingOk: boolean }) {
  return { ok: status.indexingOk, lastBlock: status.lastBlock, at: new Date().toISOString() };
}
