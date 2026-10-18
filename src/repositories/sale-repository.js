import { withImmediateTransaction } from "../db/transaction.js";

const SALE_COLUMNS = `
  id,
  inventory_item_id AS inventoryItemId,
  sale_listing_id AS saleListingId,
  marketplace,
  sale_price_krw AS salePriceKrw,
  sold_at AS soldAt,
  note
`;

function assertPositiveId(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
}

function assertNullablePositiveId(value, fieldName) {
  if (value !== null) {
    assertPositiveId(value, fieldName);
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

export function createSale(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }

  const {
    inventoryItemId,
    saleListingId = null,
    marketplace,
    salePriceKrw,
    soldAt,
    note = null,
  } = data;

  assertPositiveId(inventoryItemId, "inventoryItemId");
  assertNullablePositiveId(saleListingId, "saleListingId");
  assertNonEmptyString(marketplace, "marketplace");
  assertNonNegativeInteger(salePriceKrw, "salePriceKrw");
  assertNonEmptyString(soldAt, "soldAt");
  assertNullableString(note, "note");

  return withImmediateTransaction(database, () => {
    const inventoryItem = database
      .prepare("SELECT id FROM inventory_items WHERE id = ?")
      .get(inventoryItemId);
    if (!inventoryItem) {
      throw new Error(`Inventory item not found: ${inventoryItemId}`);
    }

    if (saleListingId !== null) {
      const saleListing = database.prepare(`
        SELECT inventory_item_id AS inventoryItemId
        FROM sale_listings
        WHERE id = ?
      `).get(saleListingId);
      if (!saleListing) {
        throw new Error(`Sale listing not found: ${saleListingId}`);
      }
      if (saleListing.inventoryItemId !== inventoryItemId) {
        throw new Error(
          `Sale listing ${saleListingId} does not belong to inventory item ${inventoryItemId}`,
        );
      }
    }

    const result = database.prepare(`
      INSERT INTO sales (
        inventory_item_id,
        sale_listing_id,
        marketplace,
        sale_price_krw,
        sold_at,
        note
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      inventoryItemId,
      saleListingId,
      marketplace,
      salePriceKrw,
      soldAt,
      note,
    );

    return findSaleById(database, Number(result.lastInsertRowid));
  });
}

export function findSaleById(database, id) {
  assertPositiveId(id, "id");
  return normalizeRow(database.prepare(`
    SELECT ${SALE_COLUMNS}
    FROM sales
    WHERE id = ?
  `).get(id));
}

export function findSaleByInventoryItemId(database, inventoryItemId) {
  assertPositiveId(inventoryItemId, "inventoryItemId");
  return normalizeRow(database.prepare(`
    SELECT ${SALE_COLUMNS}
    FROM sales
    WHERE inventory_item_id = ?
  `).get(inventoryItemId));
}

const SALE_VIEW_SQL = `
  SELECT s.id AS saleId, s.inventory_item_id AS inventoryItemId,
    s.marketplace, s.sale_price_krw AS salePriceKrw, s.sold_at AS soldAt,
    i.inventory_code AS inventoryCode, i.brand, i.model_name AS modelName,
    i.archived_at AS archivedAt
  FROM sales s
  JOIN inventory_items i ON i.id = s.inventory_item_id
  WHERE i.state = 'SOLD'
`;

export function countValidSales(database) {
  return database.prepare(`
    SELECT COUNT(*) AS total
    FROM sales s
    JOIN inventory_items i ON i.id = s.inventory_item_id
    WHERE i.state = 'SOLD'
  `).get().total;
}

export function listValidSalesPage(database, { page = 0, pageSize = 5 } = {}) {
  if (!Number.isSafeInteger(page) || page < 0 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 20) {
    throw new TypeError("Invalid sales page");
  }
  const total = countValidSales(database);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = database.prepare(`
    ${SALE_VIEW_SQL}
    ORDER BY s.sold_at DESC, s.id DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, currentPage * pageSize).map(row => ({ ...row }));
  return { rows, total, page: currentPage, pages, pageSize };
}

export function findValidSaleById(database, saleId) {
  if (!Number.isSafeInteger(saleId) || saleId <= 0) return null;
  const row = database.prepare(`${SALE_VIEW_SQL} AND s.id = ?`).get(saleId);
  return row ? { ...row } : null;
}
