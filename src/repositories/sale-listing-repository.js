const SALE_LISTING_COLUMNS = `
  id,
  inventory_item_id AS inventoryItemId,
  marketplace,
  asking_price_krw AS askingPriceKrw,
  listed_at AS listedAt,
  closed_at AS closedAt,
  url,
  external_listing_id AS externalListingId
`;

function assertPositiveId(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
}

function assertNullableString(value, fieldName) {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string or null`);
  }
}

function normalizeRow(row) {
  return row ? { ...row } : null;
}

export function createSaleListing(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }

  const {
    inventoryItemId,
    marketplace,
    askingPriceKrw,
    listedAt,
    closedAt = null,
    url = null,
    externalListingId = null,
  } = data;

  assertPositiveId(inventoryItemId, "inventoryItemId");
  assertNonEmptyString(marketplace, "marketplace");
  assertNonNegativeInteger(askingPriceKrw, "askingPriceKrw");
  assertNonEmptyString(listedAt, "listedAt");
  assertNullableString(closedAt, "closedAt");
  assertNullableString(url, "url");
  assertNullableString(externalListingId, "externalListingId");

  const inventoryItem = database
    .prepare("SELECT id FROM inventory_items WHERE id = ?")
    .get(inventoryItemId);
  if (!inventoryItem) {
    throw new Error(`Inventory item not found: ${inventoryItemId}`);
  }

  const result = database.prepare(`
    INSERT INTO sale_listings (
      inventory_item_id,
      marketplace,
      asking_price_krw,
      listed_at,
      closed_at,
      url,
      external_listing_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    inventoryItemId,
    marketplace,
    askingPriceKrw,
    listedAt,
    closedAt,
    url,
    externalListingId,
  );

  return findSaleListingById(database, Number(result.lastInsertRowid));
}

export function findSaleListingById(database, id) {
  assertPositiveId(id, "id");
  return normalizeRow(database.prepare(`
    SELECT ${SALE_LISTING_COLUMNS}
    FROM sale_listings
    WHERE id = ?
  `).get(id));
}

export function listSaleListingsByInventoryItemId(database, inventoryItemId) {
  assertPositiveId(inventoryItemId, "inventoryItemId");
  return database.prepare(`
    SELECT ${SALE_LISTING_COLUMNS}
    FROM sale_listings
    WHERE inventory_item_id = ?
    ORDER BY listed_at ASC, id ASC
  `).all(inventoryItemId).map((row) => ({ ...row }));
}

export function closeSaleListing(database, id, closedAt = new Date().toISOString()) {
  assertPositiveId(id, "id");
  assertNonEmptyString(closedAt, "closedAt");

  const result = database.prepare(`
    UPDATE sale_listings
    SET closed_at = ?
    WHERE id = ?
  `).run(closedAt, id);
  if (result.changes === 0) {
    throw new Error(`Sale listing not found: ${id}`);
  }

  return findSaleListingById(database, id);
}
