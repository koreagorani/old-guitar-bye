import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  createAcquisition,
  updateAcquisitionState,
} from "../../src/repositories/acquisition-repository.js";
import {
  addExpense,
  findExpenseById,
  listExpensesByInventoryItemId,
} from "../../src/repositories/expense-repository.js";
import {
  createInventoryItem,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "expense-repository-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

let fixtureNumber = 0;

function createInventoryFixture(database) {
  fixtureNumber += 1;
  const suffix = fixtureNumber;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `expense-listing-${suffix}`,
    url: `https://example.com/expense-listing-${suffix}`,
    title: "Yamaha F310",
    description: "Playable used guitar",
    askingPriceKrw: 50000,
    sellerLocationText: "Seoul",
    discoveredAt: "2026-09-12T00:00:00Z",
    lastSeenAt: "2026-09-12T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
    boughtAt: "2026-09-13T00:00:00Z",
    agreedPurchasePriceKrw: 40000,
  });
  acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-14T00:00:00Z",
  });

  return createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode: `G-${String(suffix).padStart(4, "0")}`,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-14T00:00:00Z",
  });
}

function expenseData(inventoryItemId, overrides = {}) {
  return {
    inventoryItemId,
    category: "LOGISTICS",
    amountKrw: 5000,
    note: "Delivery fee",
    occurredAt: "2026-09-14T09:00:00Z",
    ...overrides,
  };
}

test("creates an expense", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const expense = addExpense(database, expenseData(inventoryItem.id));

  assert.deepEqual(expense, {
    id: expense.id,
    inventoryItemId: inventoryItem.id,
    category: "LOGISTICS",
    amountKrw: 5000,
    note: "Delivery fee",
    occurredAt: "2026-09-14T09:00:00Z",
  });
}));

test("finds an expense by id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const expense = addExpense(database, expenseData(inventoryItem.id));

  assert.deepEqual(findExpenseById(database, expense.id), expense);
}));

test("returns null when an expense does not exist", () => withDatabase((database) => {
  assert.equal(findExpenseById(database, 999), null);
}));

test("lists expenses for an inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const expense = addExpense(database, expenseData(inventoryItem.id));

  assert.deepEqual(
    listExpensesByInventoryItemId(database, inventoryItem.id),
    [expense],
  );
}));

test("orders expenses by occurredAt and then id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const secondAtSameTime = addExpense(database, expenseData(inventoryItem.id, {
    category: "PACKAGING",
    occurredAt: "2026-09-14T10:00:00Z",
  }));
  const first = addExpense(database, expenseData(inventoryItem.id, {
    category: "LOGISTICS",
    occurredAt: "2026-09-14T08:00:00Z",
  }));
  const firstAtSameTime = addExpense(database, expenseData(inventoryItem.id, {
    category: "MARKETPLACE_FEE",
    occurredAt: "2026-09-14T10:00:00Z",
  }));

  assert.deepEqual(
    listExpensesByInventoryItemId(database, inventoryItem.id),
    [first, secondAtSameTime, firstAtSameTime],
  );
}));

test("rejects a missing inventory item", () => withDatabase((database) => {
  assert.throws(
    () => addExpense(database, expenseData(999999)),
    new Error("Inventory item not found: 999999"),
  );
}));

test("rejects a negative amount", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => addExpense(database, expenseData(inventoryItem.id, {
      amountKrw: -1,
    })),
    /amountKrw must be a non-negative safe integer/,
  );
}));

test("allows a zero amount", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const expense = addExpense(database, expenseData(inventoryItem.id, {
    amountKrw: 0,
  }));

  assert.equal(expense.amountKrw, 0);
}));

test("allows multiple expenses for one inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  addExpense(database, expenseData(inventoryItem.id));
  addExpense(database, expenseData(inventoryItem.id, {
    category: "PACKAGING",
    amountKrw: 2000,
  }));
  addExpense(database, expenseData(inventoryItem.id, {
    category: "MARKETPLACE_FEE",
    amountKrw: 3000,
  }));

  assert.equal(
    listExpensesByInventoryItemId(database, inventoryItem.id).length,
    3,
  );
}));

test("does not mix expenses from different inventory items", () => withDatabase((database) => {
  const firstInventoryItem = createInventoryFixture(database);
  const secondInventoryItem = createInventoryFixture(database);
  const firstExpense = addExpense(
    database,
    expenseData(firstInventoryItem.id),
  );
  addExpense(database, expenseData(secondInventoryItem.id, {
    category: "OTHER",
  }));

  assert.deepEqual(
    listExpensesByInventoryItemId(database, firstInventoryItem.id),
    [firstExpense],
  );
}));

test("returns an empty list when an inventory item has no expenses", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.deepEqual(
    listExpensesByInventoryItemId(database, inventoryItem.id),
    [],
  );
}));

test("validates the supported expense categories", async (t) => {
  const categories = [
    "LOGISTICS",
    "PACKAGING",
    "MARKETPLACE_FEE",
    "OTHER",
  ];

  for (const category of categories) {
    await t.test(category, () => withDatabase((database) => {
      const inventoryItem = createInventoryFixture(database);
      assert.equal(
        addExpense(database, expenseData(inventoryItem.id, { category }))
          .category,
        category,
      );
    }));
  }
});

test("rejects an unknown expense category", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => addExpense(database, expenseData(inventoryItem.id, {
      category: "TRANSPORT",
    })),
    new TypeError("Unknown expense category: TRANSPORT"),
  );
}));
