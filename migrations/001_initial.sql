CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  marketplace TEXT NOT NULL,
  external_listing_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  asking_price_krw INTEGER NOT NULL CHECK (asking_price_krw >= 0),
  seller_location_text TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (marketplace, external_listing_id)
) STRICT;

CREATE TABLE acquisitions (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('FOUND', 'BUYING', 'RECEIVED', 'IGNORED', 'CANCELLED')
  ),
  agreed_purchase_price_krw INTEGER
    CHECK (agreed_purchase_price_krw IS NULL OR agreed_purchase_price_krw >= 0),
  bought_at TEXT,
  received_at TEXT,
  note TEXT,
  FOREIGN KEY (listing_id) REFERENCES listings(id)
) STRICT;

CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY,
  inventory_code TEXT NOT NULL UNIQUE,
  acquisition_id INTEGER NOT NULL UNIQUE,
  brand TEXT NOT NULL,
  model_name TEXT NOT NULL,
  guitar_type TEXT NOT NULL,
  serial_number TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('IN_STOCK', 'REPAIRING', 'FOR_SALE', 'SOLD')
  ),
  storage_location TEXT,
  purchase_price_krw INTEGER NOT NULL CHECK (purchase_price_krw >= 0),
  received_at TEXT NOT NULL,
  expected_sale_price_krw INTEGER
    CHECK (expected_sale_price_krw IS NULL OR expected_sale_price_krw >= 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (acquisition_id) REFERENCES acquisitions(id)
) STRICT;

CREATE TABLE repair_logs (
  id INTEGER PRIMARY KEY,
  inventory_item_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  cost_krw INTEGER NOT NULL CHECK (cost_krw >= 0),
  minutes_spent INTEGER CHECK (minutes_spent IS NULL OR minutes_spent >= 0),
  note TEXT,
  performed_at TEXT NOT NULL,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
) STRICT;

CREATE INDEX repair_logs_inventory_item_id_idx
  ON repair_logs(inventory_item_id);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  inventory_item_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  amount_krw INTEGER NOT NULL CHECK (amount_krw >= 0),
  note TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
) STRICT;

CREATE INDEX expenses_inventory_item_id_idx
  ON expenses(inventory_item_id);

CREATE TABLE sale_listings (
  id INTEGER PRIMARY KEY,
  inventory_item_id INTEGER NOT NULL,
  marketplace TEXT NOT NULL,
  asking_price_krw INTEGER NOT NULL CHECK (asking_price_krw >= 0),
  listed_at TEXT NOT NULL,
  closed_at TEXT,
  url TEXT,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
) STRICT;

CREATE INDEX sale_listings_inventory_item_id_idx
  ON sale_listings(inventory_item_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  inventory_item_id INTEGER NOT NULL UNIQUE,
  sale_price_krw INTEGER NOT NULL CHECK (sale_price_krw >= 0),
  sold_at TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  note TEXT,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
) STRICT;
