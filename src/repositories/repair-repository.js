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


export function updateRepairLog(
  database,
  inventoryItemId,
  repairLogId,
  changes,
) {
  assertPositiveId(inventoryItemId, "inventoryItemId");
  assertPositiveId(repairLogId, "repairLogId");
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) {
    throw new TypeError("changes must be an object");
  }

  const hasType = Object.hasOwn(changes, "type");
  const hasCost = Object.hasOwn(changes, "costKrw");
  if (!hasType && !hasCost) {
    throw new TypeError("changes must include type or costKrw");
  }
  if (hasType) {
    assertNonEmptyString(changes.type, "type");
  }
  if (hasCost) {
    assertNonNegativeInteger(changes.costKrw, "costKrw");
  }

  const existing = findRepairLogById(database, repairLogId);
  if (!existing) {
    throw new Error(`Repair log not found: ${repairLogId}`);
  }
  if (existing.inventoryItemId !== inventoryItemId) {
    throw new Error(
      `Repair log ${repairLogId} does not belong to inventory item ${inventoryItemId}`,
    );
  }

  database.prepare(`
    UPDATE repair_logs
    SET type = ?, cost_krw = ?
    WHERE id = ? AND inventory_item_id = ?
  `).run(
    hasType ? changes.type.trim() : existing.type,
    hasCost ? changes.costKrw : existing.costKrw,
    repairLogId,
    inventoryItemId,
  );

  return findRepairLogById(database, repairLogId);
}
