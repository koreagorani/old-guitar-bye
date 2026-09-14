import { transitionInventory } from "../domain/inventory/inventory-state.js";

const INVENTORY_COLUMNS = `
  id,
  inventory_code AS inventoryCode,
  acquisition_id AS acquisitionId,
  brand,
  model_name AS modelName,
  guitar_type AS guitarType,
  serial_number AS serialNumber,
  state,
  storage_location AS storageLocation,
  purchase_price_krw AS purchasePriceKrw,
  received_at AS receivedAt,
  expected_sale_price_krw AS expectedSalePriceKrw,
  note,
  created_at AS createdAt,
  updated_at AS updatedAt
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

function assertNullableString(value, fieldName) {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string or null`);
  }
}

function assertNullablePrice(value, fieldName) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(
      `${fieldName} must be a non-negative safe integer or null`,
    );
  }
}

function normalizeRow(row) {
  return row ? { ...row } : null;
}

export function createInventoryItem(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }
  if (Object.hasOwn(data, "state")) {
    throw new TypeError("Inventory state is fixed to IN_STOCK when created");
  }

  const {
    acquisitionId,
    inventoryCode,
    brand,
    modelName,
    guitarType,
    serialNumber = null,
    storageLocation = null,
    purchasePriceKrw,
    receivedAt,
    expectedSalePriceKrw = null,
    note = null,
  } = data;

  assertPositiveId(acquisitionId, "acquisitionId");
  assertNonEmptyString(inventoryCode, "inventoryCode");
  assertNonEmptyString(brand, "brand");
  assertNonEmptyString(modelName, "modelName");
  assertNonEmptyString(guitarType, "guitarType");
  assertNullableString(serialNumber, "serialNumber");
  assertNullableString(storageLocation, "storageLocation");
  assertNullablePrice(purchasePriceKrw, "purchasePriceKrw");
  if (purchasePriceKrw === null) {
    throw new TypeError("purchasePriceKrw must be a non-negative safe integer");
  }
  assertNonEmptyString(receivedAt, "receivedAt");
  assertNullablePrice(expectedSalePriceKrw, "expectedSalePriceKrw");
  assertNullableString(note, "note");

  database.exec("BEGIN IMMEDIATE;");
  try {
    const acquisition = database
      .prepare("SELECT status FROM acquisitions WHERE id = ?")
      .get(acquisitionId);
    if (!acquisition) {
      throw new Error(`Acquisition not found: ${acquisitionId}`);
    }
    if (acquisition.status !== "RECEIVED") {
      throw new Error(
        `Inventory item requires a RECEIVED acquisition: ${acquisitionId}`,
      );
    }

    const result = database.prepare(`
      INSERT INTO inventory_items (
        inventory_code,
        acquisition_id,
        brand,
        model_name,
        guitar_type,
        serial_number,
        state,
        storage_location,
        purchase_price_krw,
        received_at,
        expected_sale_price_krw,
        note
      ) VALUES (?, ?, ?, ?, ?, ?, 'IN_STOCK', ?, ?, ?, ?, ?)
    `).run(
      inventoryCode,
      acquisitionId,
      brand,
      modelName,
      guitarType,
      serialNumber,
      storageLocation,
      purchasePriceKrw,
      receivedAt,
      expectedSalePriceKrw,
      note,
    );

    const inventoryItem = findInventoryItemById(
      database,
      Number(result.lastInsertRowid),
    );
    database.exec("COMMIT;");
    return inventoryItem;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function findInventoryItemById(database, id) {
  assertPositiveId(id, "id");
  return normalizeRow(database.prepare(`
    SELECT ${INVENTORY_COLUMNS}
    FROM inventory_items
    WHERE id = ?
  `).get(id));
}

export function findInventoryItemByCode(database, inventoryCode) {
  assertNonEmptyString(inventoryCode, "inventoryCode");
  return normalizeRow(database.prepare(`
    SELECT ${INVENTORY_COLUMNS}
    FROM inventory_items
    WHERE inventory_code = ?
  `).get(inventoryCode));
}

export function findInventoryItemByAcquisitionId(database, acquisitionId) {
  assertPositiveId(acquisitionId, "acquisitionId");
  return normalizeRow(database.prepare(`
    SELECT ${INVENTORY_COLUMNS}
    FROM inventory_items
    WHERE acquisition_id = ?
  `).get(acquisitionId));
}

export function updateInventoryState(database, id, nextState) {
  assertPositiveId(id, "id");

  database.exec("BEGIN IMMEDIATE;");
  try {
    const current = findInventoryItemById(database, id);
    if (!current) {
      throw new Error(`Inventory item not found: ${id}`);
    }

    const validatedState = transitionInventory(current.state, nextState);
    database.prepare(`
      UPDATE inventory_items
      SET state = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(validatedState, id);

    const updated = findInventoryItemById(database, id);
    database.exec("COMMIT;");
    return updated;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
