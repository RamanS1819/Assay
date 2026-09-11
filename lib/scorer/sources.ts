/**
 * Network adapters for the scorer's live data.
 *
 * Two Graph products, composed:
 *   - The Graph, Messari STANDARDIZED lending schema  -> leverage + maturity signals
 *   - The Graph Token API                             -> portfolio signals
 *
 * The GraphQL field names below are a reconstruction of the Messari standardized
 * "lending" schema and the Token API response shape. They MUST be verified against
 * the live endpoints once GRAPH_* env vars are set (a day-1 check). The PARSING
 * (parseLending / parsePortfolio) and everything downstream is unit-tested against
 * fixtures, so only the exact field names are unverified here.
 */
import type { ScoreInputs } from '../types/index';

// ---- raw shapes the parsers produce (the boundary the pure logic depends on) ----

export interface RawLendingData {
  firstActivityBlock: number | null; // first lending interaction; null = no lending history
  currentBlock: number; // subgraph head (_meta)
  activeDays: number; // not in the lending schema yet; refine later, default 0
  txCount: number; // count of the account's lending interactions
  openBorrowsUsd: number;
  collateralUsd: number;
  minHealthFactor: number | null; // proxy = collateral/borrows; null = never borrowed
  liquidationCount: number; // times this account was the liquidatee
}

export interface RawBalance {
  symbol: string;
  valueUsd: number;
  isStablecoin: boolean;
}
export type RawPortfolio = RawBalance[];

export interface CounterpartyData {
  flaggedInteractionCount: number;
  totalCounterparties: number;
}

// Used by the portfolio-quality signal to know which holdings are stable value.
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'FRAX', 'TUSD', 'USDP', 'GUSD', 'LUSD', 'PYUSD']);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ---------------------------------------------------------------------------
// The Graph — Messari standardized lending schema
// ---------------------------------------------------------------------------

// Verified against the live Messari Aave v3 subgraph. Liquidations are counted from
// the `liquidates` events for this account — the account-level `liquidationCount`
// counter is not reliably populated in this deployment.
export const LENDING_QUERY = `
query AccountLending($id: ID!) {
  account(id: $id) {
    id
    depositCount
    borrowCount
    positions(first: 1000) {
      side
      balance
      isCollateral
      blockNumberOpened
      asset { symbol decimals lastPriceUSD }
    }
  }
  liquidates(where: { liquidatee: $id }, first: 1000) { id }
  _meta { block { number } }
}`;

/** Pure: raw GraphQL `data` -> RawLendingData. Unit-tested with fixtures. */
export function parseLending(data: any): RawLendingData {
  const account = data?.account;
  const currentBlock = Number(data?._meta?.block?.number ?? 0);
  if (!account) {
    return { firstActivityBlock: null, currentBlock, activeDays: 0, txCount: 0, openBorrowsUsd: 0, collateralUsd: 0, minHealthFactor: null, liquidationCount: 0 };
  }
  let openBorrowsUsd = 0;
  let collateralUsd = 0;
  let firstBlock: number | null = null;
  for (const p of account.positions ?? []) {
    const decimals = Number(p.asset?.decimals ?? 18);
    const price = Number(p.asset?.lastPriceUSD ?? 0);
    const usd = (Number(p.balance ?? 0) / 10 ** decimals) * price;
    if (p.side === 'BORROWER') openBorrowsUsd += usd;
    if (p.isCollateral) collateralUsd += usd;
    const b = Number(p.blockNumberOpened ?? 0);
    if (b > 0) firstBlock = firstBlock === null ? b : Math.min(firstBlock, b);
  }
  // Proxy health factor: the standardized schema exposes balances, not HF.
  const minHealthFactor = openBorrowsUsd > 0 ? collateralUsd / openBorrowsUsd : null;
  return {
    firstActivityBlock: firstBlock,
    currentBlock,
    activeDays: 0,
    txCount: Number(account.depositCount ?? 0) + Number(account.borrowCount ?? 0),
    openBorrowsUsd,
    collateralUsd,
    minHealthFactor,
    liquidationCount: (data?.liquidates ?? []).length, // counted from liquidates events
  };
}

export async function fetchLending(address: string): Promise<RawLendingData> {
  const res = await fetch(env('GRAPH_LENDING_SUBGRAPH_URL'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env('GRAPH_API_KEY')}` },
    body: JSON.stringify({ query: LENDING_QUERY, variables: { id: address.toLowerCase() } }),
  });
  if (!res.ok) throw new Error(`Graph lending query failed: ${res.status}`);
  const json = (await res.json()) as any;
  if (json.errors) throw new Error(`Graph lending errors: ${JSON.stringify(json.errors)}`);
  return parseLending(json.data);
}

// ---------------------------------------------------------------------------
// The Graph Token API — balances / portfolio
// ---------------------------------------------------------------------------

/** Pure: raw Token API body -> RawPortfolio. Unit-tested with fixtures. */
export function parsePortfolio(data: any): RawPortfolio {
  const rows: any[] = data?.balances ?? data?.data ?? (Array.isArray(data) ? data : []);
  return rows
    .map((r) => {
      const symbol = String(r.symbol ?? r.token_symbol ?? '').toUpperCase();
      const valueUsd = Number(r.valueUsd ?? r.value_usd ?? r.valueUSD ?? 0);
      return { symbol, valueUsd, isStablecoin: STABLES.has(symbol) };
    })
    .filter((b) => Number.isFinite(b.valueUsd));
}

export async function fetchPortfolio(address: string): Promise<RawPortfolio> {
  // VERIFY the Token API path once GRAPH_TOKEN_API_URL is set.
  const res = await fetch(`${env('GRAPH_TOKEN_API_URL')}/balances/evm/${address.toLowerCase()}`, {
    headers: { authorization: `Bearer ${env('GRAPH_API_KEY')}` },
  });
  if (!res.ok) throw new Error(`Token API query failed: ${res.status}`);
  return parsePortfolio(await res.json());
}

// ---------------------------------------------------------------------------
// The Graph — the watcher's ONE global liquidation query (plan §3).
// One query every ~60s across every lending protocol, filtered locally. This is
// what keeps the query budget flat regardless of how many holders are watched.
// ---------------------------------------------------------------------------

export interface LiquidationEvent {
  liquidatee: string;
  blockNumber: number;
}

export const LIQUIDATIONS_QUERY = `
query Liquidations($from: BigInt!, $to: BigInt!) {
  liquidates(
    where: { blockNumber_gte: $from, blockNumber_lte: $to }
    orderBy: blockNumber
    orderDirection: asc
    first: 1000
  ) {
    blockNumber
    liquidatee { id }
  }
}`;

/** Pure: raw GraphQL `data` -> liquidation events. Unit-tested with fixtures. */
export function parseLiquidations(data: any): LiquidationEvent[] {
  const rows: any[] = data?.liquidates ?? [];
  return rows
    .map((r) => ({
      liquidatee: String(r.liquidatee?.id ?? r.liquidatee ?? '').toLowerCase(),
      blockNumber: Number(r.blockNumber ?? 0),
    }))
    .filter((e) => e.liquidatee !== '');
}

export async function fetchLiquidations(fromBlock: number, toBlock: number): Promise<LiquidationEvent[]> {
  const res = await fetch(env('GRAPH_LENDING_SUBGRAPH_URL'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env('GRAPH_API_KEY')}` },
    body: JSON.stringify({ query: LIQUIDATIONS_QUERY, variables: { from: String(fromBlock), to: String(toBlock) } }),
  });
  if (!res.ok) throw new Error(`Graph liquidations query failed: ${res.status}`);
  const json = (await res.json()) as any;
  if (json.errors) throw new Error(`Graph liquidations errors: ${JSON.stringify(json.errors)}`);
  return parseLiquidations(json.data);
}

export const HEAD_BLOCK_QUERY = `query { _meta { block { number } } }`;

export async function fetchHeadBlock(): Promise<number> {
  const res = await fetch(env('GRAPH_LENDING_SUBGRAPH_URL'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env('GRAPH_API_KEY')}` },
    body: JSON.stringify({ query: HEAD_BLOCK_QUERY }),
  });
  if (!res.ok) throw new Error(`Graph head-block query failed: ${res.status}`);
  const json = (await res.json()) as any;
  return Number(json?.data?._meta?.block?.number ?? 0);
}

export type { ScoreInputs };
