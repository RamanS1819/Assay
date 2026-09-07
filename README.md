# Assay

**A pay-per-query onchain credit bureau any AI agent can buy from with only a wallet, plus an autonomous transfer agent that uses it to underwrite a tokenized credit line.**

Built from scratch for ETHGlobal Online 2026. Partners: **The Graph** · **Hedera** · **Privy**.

An AI agent that holds a wallet can now spend from it. But before it sends funds or extends credit, it must answer one question: *is this address safe to transact with?* Every good answer to that is sold in a human-shaped container: an API key, a subscription, a KYC'd account. An agent has none of those. Assay sells the answer per-query, for a fraction of a cent, with a wallet as the only credential.

The score isn't a number in a JSON body. It continuously decides who may hold a real on-chain asset: a transfer reverts on-chain because two tenths of a cent were spent off-chain.

## How the pieces compose (each is load-bearing)

- **The Graph** — the scorer reads borrowing history across *many* lending protocols at once through the Messari standardized schema, and the agent queries it in natural language via the Subgraph MCP. One query pattern, every protocol.
- **Hedera** — the score is sold behind an x402 paywall settled by Blocky402; the credit line is a token whose transfers a control list gates.
- **Privy** — a server wallet holds the agent's key and enforces spend caps + a 2-of-3 quorum, so autonomous spend is safe and escalation is un-bypassable.

> **The LLM does not compute the score.** Scoring is deterministic, explainable arithmetic (see `lib/scorer/model.ts`). The LLM decides *which* addresses are worth paying to score against a finite budget, what limit a score justifies, and writes the rationale a human reviewer reads.

## Status

Early build. Foundation first:

- [x] Type contracts (`lib/types`) — zod schemas for `Score`, `ScoreInputs`, `Policy`, `UnderwritingDecision`, `AuditEvent`
- [x] Deterministic scoring model (`lib/scorer/model.ts`) + unit tests
- [ ] Scorer over Messari standardized schema + Token API (live data)
- [ ] x402 gate (Blocky402) wrapping scorer routes
- [ ] Privy server wallet paying invoices under policy
- [ ] The agent loop
- [ ] Allowlist credit token on Hedera (verified on HashScan)
- [ ] Console

Planning docs: `ASSAY-MASTER-PLAN.md` (the build plan), `ASSAY-TEST-PLAN.md`, `ASSAY-DECISIONS.md`, `ASSAY-SPEC.md`.

## Develop

```bash
npm install
npm test          # run the model unit tests
npm run typecheck # tsc --noEmit
```

Copy `.env.example` to `.env` and fill in the keys (all free tiers). `.env` is gitignored.

## Non-goals

Not a validated credit model (five weighted heuristics on public chain data). No sybil resistance. Testnet issuance only. A consumer of Graph data, not a Graph indexing contribution.
