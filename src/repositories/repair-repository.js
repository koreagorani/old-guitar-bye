const REPAIR_TYPES = new Set([
  "CLEANING",
  "STRING_CHANGE",
  "NECK_ADJUSTMENT",
  "ACTION_ADJUSTMENT",
  "FRET_WORK",
  "ELECTRONICS",
  "OTHER",
]);

const REPAIR_LOG_COLUMNS = `
  id,
  inventory_item_id AS inventoryItemId,
  type,
  cost_krw AS costKrw,
  minutes_spent AS minutesSpent,
  note,
  performed_at AS performedAt
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

function assertNullableNonNegativeInteger(value, fieldName) {
  if (value !== null) {
    assertNonNegativeInteger(value, fieldName);
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

export function addRepairLog(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }

  const {
    inventoryItemId,
    type,
    costKrw,
    minutesSpent = null,
    note = null,
    performedAt,
  } = data;

  assertPositiveId(inventoryItemId, "inventoryItemId");
  assertNonEmptyString(type, "type");
  if (!REPAIR_TYPES.has(type)) {
    throw new TypeError(`Unknown repair type: ${type}`);
  }
  assertNonNegativeInteger(costKrw, "costKrw");
  assertNullableNonNegativeInteger(minutesSpent, "minutesSpent");
  assertNullableString(note, "note");
  assertNonEmptyString(performedAt, "performedAt");

  const inventoryItem = database
    .prepare("SELECT id FROM inventory_items WHERE id = ?")
    .get(inventoryItemId);
  if (!inventoryItem) {
    throw new Error(`Inventory item not found: ${inventoryItemId}`);
  }

  const result = database.prepare(`
    INSERT INTO repair_logs (
      inventory_item_id,
      type,
      cost_krw,
      minutes_spent,
      note,
      performed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    inventoryItemId,
    type,
    costKrw,
    minutesSpent,
    note,
    performedAt,
  );

  return findRepairLogById(database, Number(result.lastInsertRowid));
}

export function findRepairLogById(database, id) {
  assertPositiveId(id, "id");
  return normalizeRow(database.prepare(`
    SELECT ${REPAIR_LOG_COLUMNS}
    FROM repair_logs
    WHERE id = ?
  `).get(id));
}

export function listRepairLogsByInventoryItemId(database, inventoryItemId) {
  assertPositiveId(inventoryItemId, "inventoryItemId");
  return database.prepare(`
    SELECT ${REPAIR_LOG_COLUMNS}
    FROM repair_logs
    WHERE inventory_item_id = ?
    ORDER BY performed_at ASC, id ASC
  `).all(inventoryItemId).map((row) => ({ ...row }));
}
