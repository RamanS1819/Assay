-- Assay persistence (Neon Postgres). Minimal — a demo, not a system of record.
-- Apply with: psql "$DATABASE_URL" -f lib/db/schema.sql

-- watcher position (single row per stream)
CREATE TABLE IF NOT EXISTS agent_cursor (
  id     TEXT PRIMARY KEY,
  block  BIGINT NOT NULL
);

-- x402 payment idempotency ledger
CREATE TABLE IF NOT EXISTS payment_intents (
  key         TEXT PRIMARY KEY,               -- (subject, block bucket)
  status      TEXT NOT NULL DEFAULT 'pending',-- pending | settled
  tx_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- score cache + history
CREATE TABLE IF NOT EXISTS scores (
  address        TEXT NOT NULL,
  chain          TEXT NOT NULL,
  value          INT  NOT NULL,
  subscores      JSONB NOT NULL,
  as_of_block    BIGINT NOT NULL,
  model_version  TEXT NOT NULL,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (address, as_of_block)
);

-- x402 receipts (each settled payment, with its Hedera tx hash)
CREATE TABLE IF NOT EXISTS payments (
  tx_hash         TEXT PRIMARY KEY,
  amount          TEXT NOT NULL,
  route           TEXT NOT NULL,
  subject_address TEXT NOT NULL,
  settled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- the holder register
CREATE TABLE IF NOT EXISTS holders (
  address        TEXT PRIMARY KEY,
  units          NUMERIC NOT NULL DEFAULT 0,
  eligibility    BOOLEAN NOT NULL DEFAULT false,
  limit_units    NUMERIC NOT NULL DEFAULT 0,
  last_score_id  BIGINT
);

-- underwriting outcomes
CREATE TABLE IF NOT EXISTS decisions (
  id          BIGSERIAL PRIMARY KEY,
  subject     TEXT NOT NULL,
  limit_units NUMERIC NOT NULL,
  rationale   TEXT NOT NULL,
  as_of_block BIGINT NOT NULL,
  score_value INT NOT NULL,
  state       TEXT NOT NULL,        -- issued | escalated | revoked
  escalated   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2-of-3 quorum queue
CREATE TABLE IF NOT EXISTS approvals (
  decision_id BIGINT PRIMARY KEY REFERENCES decisions(id),
  required    INT NOT NULL,
  signatures  JSONB NOT NULL DEFAULT '[]',
  resolved_at TIMESTAMPTZ
);

-- append-only audit trail (everything worth showing in the console)
CREATE TABLE IF NOT EXISTS audit (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  tx_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
