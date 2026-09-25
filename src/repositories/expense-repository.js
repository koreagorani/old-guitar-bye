const EXPENSE_CATEGORIES = new Set([
  "LOGISTICS",
  "PACKAGING",
  "MARKETPLACE_FEE",
  "OTHER",
]);

const EXPENSE_COLUMNS = `
  id,
  inventory_item_id AS inventoryItemId,
  category,
  amount_krw AS amountKrw,
  note,
  occurred_at AS occurredAt
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

export function addExpense(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }

  const {
    inventoryItemId,
    category,
    amountKrw,
    note = null,
    occurredAt,
  } = data;

  assertPositiveId(inventoryItemId, "inventoryItemId");
  assertNonEmptyString(category, "category");
  if (!EXPENSE_CATEGORIES.has(category)) {
    throw new TypeError(`Unknown expense category: ${category}`);
  }
  assertNonNegativeInteger(amountKrw, "amountKrw");
  assertNullableString(note, "note");
  assertNonEmptyString(occurredAt, "occurredAt");

  const inventoryItem = database
    .prepare("SELECT id FROM inventory_items WHERE id = ?")
    .get(inventoryItemId);
  if (!inventoryItem) {
    throw new Error(`Inventory item not found: ${inventoryItemId}`);
  }

  const result = database.prepare(`
    INSERT INTO expenses (
      inventory_item_id,
      category,
      amount_krw,
      note,
      occurred_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    inventoryItemId,
    category,
    amountKrw,
    note,
    occurredAt,
  );

  return findExpenseById(database, Number(result.lastInsertRowid));
}

export function findExpenseById(database, id) {
  assertPositiveId(id, "id");
  return normalizeRow(database.prepare(`
    SELECT ${EXPENSE_COLUMNS}
    FROM expenses
    WHERE id = ?
  `).get(id));
}

export function listExpensesByInventoryItemId(database, inventoryItemId) {
  assertPositiveId(inventoryItemId, "inventoryItemId");
  return database.prepare(`
    SELECT ${EXPENSE_COLUMNS}
    FROM expenses
    WHERE inventory_item_id = ?
    ORDER BY occurred_at ASC, id ASC
  `).all(inventoryItemId).map((row) => ({ ...row }));
}


export function updateExpense(
  database,
  inventoryItemId,
  expenseId,
  changes,
) {
  assertPositiveId(inventoryItemId, "inventoryItemId");
  assertPositiveId(expenseId, "expenseId");
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) {
    throw new TypeError("changes must be an object");
  }

  const hasCategory = Object.hasOwn(changes, "category");
  const hasAmount = Object.hasOwn(changes, "amountKrw");
  const hasNote = Object.hasOwn(changes, "note");
  if (!hasCategory && !hasAmount && !hasNote) {
    throw new TypeError("changes must include category, amountKrw, or note");
  }
  if (hasCategory) {
    assertNonEmptyString(changes.category, "category");
    if (!EXPENSE_CATEGORIES.has(changes.category)) {
      throw new TypeError(`Unknown expense category: ${changes.category}`);
    }
  }
  if (hasAmount) {
    assertNonNegativeInteger(changes.amountKrw, "amountKrw");
  }
  if (hasNote) {
    assertNullableString(changes.note, "note");
  }

  const existing = findExpenseById(database, expenseId);
  if (!existing) {
    throw new Error(`Expense not found: ${expenseId}`);
  }
  if (existing.inventoryItemId !== inventoryItemId) {
    throw new Error(
      `Expense ${expenseId} does not belong to inventory item ${inventoryItemId}`,
    );
  }

  database.prepare(`
    UPDATE expenses
    SET category = ?, amount_krw = ?, note = ?
    WHERE id = ? AND inventory_item_id = ?
  `).run(
    hasCategory ? changes.category : existing.category,
    hasAmount ? changes.amountKrw : existing.amountKrw,
    hasNote ? changes.note : existing.note,
    expenseId,
    inventoryItemId,
  );

  return findExpenseById(database, expenseId);
}
