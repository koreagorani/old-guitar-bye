ALTER TABLE sales
ADD COLUMN sale_listing_id INTEGER REFERENCES sale_listings(id);
