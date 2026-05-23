-- ============================================================
-- Finance Command Centre Upgrade
-- Run in: Supabase Dashboard → SQL Editor
-- Date: 2026-05-23
-- ============================================================

-- ── Step 1: Extend the existing transactions table ──────────
-- These columns are additive — safe to run on live data.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_test              BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS excluded_from_reports BOOLEAN    DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source               TEXT,
  ADD COLUMN IF NOT EXISTS transaction_subtype  TEXT,
  ADD COLUMN IF NOT EXISTS subcategory          TEXT,
  ADD COLUMN IF NOT EXISTS is_archived          BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by          TEXT;

-- Indexes for common filter operations
CREATE INDEX IF NOT EXISTS idx_transactions_is_test     ON transactions(is_test);
CREATE INDEX IF NOT EXISTS idx_transactions_is_archived ON transactions(is_archived);
CREATE INDEX IF NOT EXISTS idx_transactions_source      ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_transactions_type_archived
  ON transactions(type, is_archived, is_test);

-- ── Step 2: Budget Buckets table ────────────────────────────

CREATE TABLE IF NOT EXISTS finance_budget_buckets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  category       TEXT,
  monthly_budget NUMERIC     DEFAULT 0,
  used_amount    NUMERIC     DEFAULT 0,
  notes          TEXT,
  status         TEXT        DEFAULT 'active', -- active | paused | closed
  created_by     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  archived_at    TIMESTAMPTZ,
  archived_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_budget_buckets_status ON finance_budget_buckets(status);

-- ── Step 3: Buying / Investment Items table ──────────────────

CREATE TABLE IF NOT EXISTS finance_buying_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name        TEXT        NOT NULL,
  category         TEXT,
  reason           TEXT,
  estimated_cost   NUMERIC     DEFAULT 0,
  priority         TEXT        DEFAULT 'medium', -- low | medium | high | critical
  status           TEXT        DEFAULT 'idea',   -- idea | planned | approved | bought | delayed | cancelled
  target_date      DATE,
  budget_bucket_id UUID        REFERENCES finance_budget_buckets(id) ON DELETE SET NULL,
  notes            TEXT,
  added_by         TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  archived_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_buying_items_status   ON finance_buying_items(status);
CREATE INDEX IF NOT EXISTS idx_buying_items_priority ON finance_buying_items(priority);

-- ── Step 4: Row Level Security ───────────────────────────────
-- Frontend enforces admin-only access to these tables.
-- RLS ensures only authenticated users can read/write.
-- TODO: Tighten to role-claim checks once JWT role claims are wired.

ALTER TABLE finance_budget_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_buying_items   ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'finance_budget_buckets'
      AND policyname = 'authenticated_all_budget_buckets'
  ) THEN
    CREATE POLICY "authenticated_all_budget_buckets"
      ON finance_budget_buckets FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'finance_buying_items'
      AND policyname = 'authenticated_all_buying_items'
  ) THEN
    CREATE POLICY "authenticated_all_buying_items"
      ON finance_buying_items FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END$$;

-- ── Step 5: Auto-update updated_at triggers ──────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_budget_buckets ON finance_budget_buckets;
CREATE TRIGGER set_updated_at_budget_buckets
  BEFORE UPDATE ON finance_budget_buckets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_buying_items ON finance_buying_items;
CREATE TRIGGER set_updated_at_buying_items
  BEFORE UPDATE ON finance_buying_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Done ─────────────────────────────────────────────────────
-- Verify with:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'transactions' ORDER BY ordinal_position;
