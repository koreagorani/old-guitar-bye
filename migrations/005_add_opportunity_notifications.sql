CREATE TABLE opportunity_notifications (
  id INTEGER PRIMARY KEY,
  marketplace TEXT NOT NULL,
  external_listing_id TEXT NOT NULL,
  notified_at TEXT NOT NULL,
  asking_price_krw INTEGER NOT NULL CHECK (asking_price_krw >= 0),
  reference_new_price_krw INTEGER NOT NULL CHECK (reference_new_price_krw > 0),
  ratio_pct REAL NOT NULL CHECK (ratio_pct >= 0),
  UNIQUE (marketplace, external_listing_id)
) STRICT;

CREATE INDEX opportunity_notifications_notified_at_idx
  ON opportunity_notifications(notified_at);
