ALTER TABLE listings
  RENAME COLUMN seller_location_text TO seller_location_text_legacy;

ALTER TABLE listings
  ADD COLUMN seller_location_text TEXT;

UPDATE listings
SET seller_location_text = seller_location_text_legacy;

ALTER TABLE listings
  DROP COLUMN seller_location_text_legacy;
