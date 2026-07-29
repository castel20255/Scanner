/*
# Create trade_journals table (single-tenant, no auth)

1. New Tables
- `trade_journals`
  - `id` (uuid, primary key)
  - `session_id` (text, identifies a single bot run/session)
  - `symbol` (text, market symbol traded, e.g. R_100)
  - `contract_type` (text, Deriv contract type, e.g. CALL, DIGITOVER)
  - `strategy_label` (text, human-readable strategy name, e.g. "Even/Odd", "Over 2")
  - `prediction` (integer, nullable, digit prediction if applicable)
  - `stake` (numeric, stake amount)
  - `payout` (numeric, profit/loss amount)
  - `won` (boolean, whether the trade won)
  - `entry_spot` (text, nullable, entry spot tick)
  - `exit_spot` (text, nullable, exit spot tick)
  - `recovery_mode` (boolean, whether this trade was placed in recovery/fallback mode)
  - `recovery_step` (integer, which step in the fallback chain, 0 = primary)
  - `balance_after` (numeric, nullable, account balance after trade)
  - `created_at` (timestamptz, when the trade settled)

2. Security
- Enable RLS on `trade_journals`.
- Allow anon + authenticated full CRUD (single-tenant, intentionally shared).
*/

CREATE TABLE IF NOT EXISTS trade_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  symbol text NOT NULL,
  contract_type text NOT NULL,
  strategy_label text NOT NULL,
  prediction integer,
  stake numeric(18,2) NOT NULL,
  payout numeric(18,2) NOT NULL,
  won boolean NOT NULL,
  entry_spot text,
  exit_spot text,
  recovery_mode boolean NOT NULL DEFAULT false,
  recovery_step integer NOT NULL DEFAULT 0,
  balance_after numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_journals_session ON trade_journals(session_id);
CREATE INDEX IF NOT EXISTS idx_trade_journals_created ON trade_journals(created_at DESC);

ALTER TABLE trade_journals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_trade_journals" ON trade_journals;
CREATE POLICY "anon_select_trade_journals" ON trade_journals FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_trade_journals" ON trade_journals;
CREATE POLICY "anon_insert_trade_journals" ON trade_journals FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_trade_journals" ON trade_journals;
CREATE POLICY "anon_update_trade_journals" ON trade_journals FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_trade_journals" ON trade_journals;
CREATE POLICY "anon_delete_trade_journals" ON trade_journals FOR DELETE
  TO anon, authenticated USING (true);
