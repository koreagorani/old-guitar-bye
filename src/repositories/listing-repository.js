const LISTING_COLUMNS = `
  id,
  marketplace,
  external_listing_id AS externalListingId,
  url,
  title,
  description,
  asking_price_krw AS askingPriceKrw,
  seller_location_text AS sellerLocationText,
  discovered_at AS discoveredAt,
  last_seen_at AS lastSeenAt
`;

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`listing.${fieldName} must be a non-empty string`);
  }
}

function validateListing(listing) {
  if (listing === null || typeof listing !== "object" || Array.isArray(listing)) {
    throw new TypeError("listing must be an object");
  }

  for (const fieldName of [
    "marketplace",
    "externalListingId",
    "url",
    "title",
    "sellerLocationText",
    "discoveredAt",
    "lastSeenAt",
  ]) {
    assertNonEmptyString(listing[fieldName], fieldName);
  }

  if (typeof listing.description !== "string") {
    throw new TypeError("listing.description must be a string");
  }
  if (!Number.isSafeInteger(listing.askingPriceKrw)) {
    throw new TypeError("listing.askingPriceKrw must be a safe integer");
  }
  if (listing.askingPriceKrw < 0) {
    throw new RangeError("listing.askingPriceKrw must not be negative");
  }
}

function normalizeRow(row) {
  return row ? { ...row } : null;
}

export function saveOrUpdateListing(database, listing) {
  validateListing(listing);

  database.prepare(`
    INSERT INTO listings (
      marketplace,
      external_listing_id,
      url,
      title,
      description,
      asking_price_krw,
      seller_location_text,
      discovered_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (marketplace, external_listing_id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      description = excluded.description,
      asking_price_krw = excluded.asking_price_krw,
      seller_location_text = excluded.seller_location_text,
      last_seen_at = excluded.last_seen_at
  `).run(
    listing.marketplace,
    listing.externalListingId,
    listing.url,
    listing.title,
    listing.description,
    listing.askingPriceKrw,
    listing.sellerLocationText,
    listing.discoveredAt,
    listing.lastSeenAt,
  );

  return findListingByExternalId(
    database,
    listing.marketplace,
    listing.externalListingId,
  );
}

export function findListingById(database, id) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("id must be a positive safe integer");
  }

  return normalizeRow(database.prepare(`
    SELECT ${LISTING_COLUMNS}
    FROM listings
    WHERE id = ?
  `).get(id));
}

export function findListingByExternalId(
  database,
  marketplace,
  externalListingId,
) {
  assertNonEmptyString(marketplace, "marketplace");
  assertNonEmptyString(externalListingId, "externalListingId");

  return normalizeRow(database.prepare(`
    SELECT ${LISTING_COLUMNS}
    FROM listings
    WHERE marketplace = ? AND external_listing_id = ?
  `).get(marketplace, externalListingId));
}
