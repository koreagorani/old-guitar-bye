-- The inventory state and all historical relations are preserved.
ALTER TABLE inventory_items ADD COLUMN archived_at TEXT;
CREATE INDEX inventory_items_archive_idx ON inventory_items(archived_at, id);
