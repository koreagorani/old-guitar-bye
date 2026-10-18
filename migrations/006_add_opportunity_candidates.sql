CREATE TABLE opportunity_candidates (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISMISSED', 'ACQUIRED')),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT,
  guitar_type TEXT NOT NULL,
  identity_confidence TEXT NOT NULL CHECK (identity_confidence IN ('HIGH', 'MEDIUM')),
  reference_new_price_krw INTEGER NOT NULL CHECK (reference_new_price_krw > 0),
  ratio_pct REAL NOT NULL CHECK (ratio_pct >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  acquired_at TEXT
) STRICT;

CREATE INDEX opportunity_candidates_status_ratio_idx
  ON opportunity_candidates(status, ratio_pct, id);
