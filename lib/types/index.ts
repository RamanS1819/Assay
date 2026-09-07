/**
 * The contract between every module. Build this first, keep it small.
 * Every type has a zod schema so boundaries (Graph responses, API bodies,
 * DB rows) can be validated at runtime, not just trusted at compile time.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Score — the product of the deterministic model (lib/scorer/model.ts)
// ---------------------------------------------------------------------------

export const SubscoresSchema = z.object({
  accountMaturity: z.number().min(0).max(100),
  portfolioQuality: z.number().min(0).max(100),
  leverageHistory: z.number().min(0).max(100),
  counterpartyHygiene: z.number().min(0).max(100),
  recentVolatility: z.number().min(0).max(100),
});
export type Subscores = z.infer<typeof SubscoresSchema>;

export const WeightsSchema = z.object({
  accountMaturity: z.number(),
  portfolioQuality: z.number(),
  leverageHistory: z.number(),
  counterpartyHygiene: z.number(),
  recentVolatility: z.number(),
});
export type Weights = z.infer<typeof WeightsSchema>;

export const ScoreSchema = z.object({
  address: z.string(),
  chain: z.string(),
  value: z.number().min(0).max(100),
  subscores: SubscoresSchema,
  weights: WeightsSchema,
  asOfBlock: z.number().int().nonnegative(),
  computedAt: z.string(), // ISO 8601
  inputs: z.array(z.string()), // which data sources actually contributed
  modelVersion: z.string(),
});
export type Score = z.infer<typeof ScoreSchema>;

// ---------------------------------------------------------------------------
// ScoreInputs — the raw facts the model consumes, pulled from The Graph
// (Messari standardized lending schema) + the Token API. The model is pure:
// it never touches the network, it only transforms these numbers.
// ---------------------------------------------------------------------------

export const ScoreInputsSchema = z.object({
  accountMaturity: z.object({
    firstSeenBlock: z.number().int().nonnegative(),
    currentBlock: z.number().int().nonnegative(),
    activeDays: z.number().nonnegative(),
    txCount: z.number().int().nonnegative(),
  }),
  portfolio: z.object({
    totalUsd: z.number().nonnegative(),
    stablecoinUsd: z.number().nonnegative(),
    largestPositionUsd: z.number().nonnegative(),
    positionCount: z.number().int().nonnegative(),
  }),
  leverage: z.object({
    openBorrowsUsd: z.number().nonnegative(),
    collateralUsd: z.number().nonnegative(),
    minHealthFactor: z.number().nullable(), // null = never borrowed
    liquidationCount: z.number().int().nonnegative(),
  }),
  counterparty: z.object({
    flaggedInteractionCount: z.number().int().nonnegative(),
    totalCounterparties: z.number().int().nonnegative(),
  }),
  volatility: z.object({
    balanceStdDevPct: z.number().nonnegative(), // % swing in balance since last poll
  }),
});
export type ScoreInputs = z.infer<typeof ScoreInputsSchema>;

// ---------------------------------------------------------------------------
// Policy — the agent's spend + escalation limits. Caps live in Privy policy;
// this mirrors them so the app can reason about them too.
// ---------------------------------------------------------------------------

export const PolicySchema = z.object({
  perRequestCapUsd: z.number(), // e.g. 0.05
  dailyCapUsd: z.number(), // e.g. 5.00
  quorumThresholdUnits: z.number(), // above this, escalate to humans
  quorumRequired: z.number().int(), // e.g. 2
  quorumSigners: z.number().int(), // e.g. 3
});
export type Policy = z.infer<typeof PolicySchema>;

// ---------------------------------------------------------------------------
// UnderwritingDecision — what the LLM produces from a Score + exposure.
// ---------------------------------------------------------------------------

export const UnderwritingDecisionSchema = z.object({
  subject: z.string(),
  limit: z.number().nonnegative(),
  rationale: z.string(),
  scoreRef: z.object({
    address: z.string(),
    asOfBlock: z.number().int().nonnegative(),
    value: z.number(),
  }),
  revokes: z.boolean(),
  escalated: z.boolean(),
});
export type UnderwritingDecision = z.infer<typeof UnderwritingDecisionSchema>;

// ---------------------------------------------------------------------------
// AuditEvent — append-only, everything worth showing in the console.
// ---------------------------------------------------------------------------

export const AuditEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('payment'), txHash: z.string(), amountUsd: z.number(), route: z.string(), subject: z.string(), at: z.string() }),
  z.object({ type: z.literal('score'), subject: z.string(), value: z.number(), asOfBlock: z.number().int(), at: z.string() }),
  z.object({ type: z.literal('decision'), subject: z.string(), limit: z.number(), escalated: z.boolean(), at: z.string() }),
  z.object({ type: z.literal('execution'), txHash: z.string(), action: z.enum(['issue', 'revoke']), subject: z.string(), at: z.string() }),
  z.object({ type: z.literal('skip'), subject: z.string(), reason: z.string(), at: z.string() }),
  z.object({ type: z.literal('error'), source: z.string(), message: z.string(), at: z.string() }),
]);
export type AuditEvent = z.infer<typeof AuditEventSchema>;
