import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  updateExpenseRecord,
  updateRepairRecord,
} from "../../src/application/inventory/update-inventory-record.js";
import { createAcquisition, updateAcquisitionState } from "../../src/repositories/acquisition-repository.js";
import { addExpense } from "../../src/repositories/expense-repository.js";
import { createInventoryItem } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { addRepairLog } from "../../src/repositories/repair-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-record-update-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

let n = 0;
function inventory(database) {
  n += 1;
  const listing = saveOrUpdateListing(database, {
    marketplace: "MANUAL",
    externalListingId: `record-update-${n}`,
    url: `manual://record-update-${n}`,
    title: "Yamaha F310",
    description: "",
    askingPriceKrw: 40000,
    sellerLocationText: "직접 등록",
    discoveredAt: "2026-09-25T00:00:00Z",
    lastSeenAt: "2026-09-25T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
    agreedPurchasePriceKrw: 40000,
    boughtAt: "2026-09-25T00:00:00Z",
  });
  acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-25T00:00:00Z",
  });
  return createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode: `G-${String(n).padStart(4, "0")}`,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-25T00:00:00Z",
    expectedSalePriceKrw: 90000,
  });
}

test("repair update preserves performedAt and other history fields", () => withDatabase((database) => {
  const item = inventory(database);
  const repair = addRepairLog(database, {
    inventoryItemId: item.id,
    type: "세척",
    costKrw: 5000,
    minutesSpent: 20,
    note: "original",
    performedAt: "2026-09-20T10:00:00Z",
  });
  const updated = updateRepairRecord(database, item.id, repair.id, {
    type: "줄 교체",
    costKrw: 8000,
  });
  assert.equal(updated.type, "줄 교체");
  assert.equal(updated.costKrw, 8000);
  assert.equal(updated.performedAt, repair.performedAt);
  assert.equal(updated.minutesSpent, repair.minutesSpent);
  assert.equal(updated.note, repair.note);
}));

test("expense update preserves occurredAt", () => withDatabase((database) => {
  const item = inventory(database);
  const expense = addExpense(database, {
    inventoryItemId: item.id,
    category: "LOGISTICS",
    amountKrw: 4500,
    note: "택배",
    occurredAt: "2026-09-20T10:00:00Z",
  });
  const updated = updateExpenseRecord(database, item.id, expense.id, {
    category: "OTHER",
    note: "기타",
    amountKrw: 3000,
  });
  assert.equal(updated.occurredAt, expense.occurredAt);
  assert.equal(updated.category, "OTHER");
  assert.equal(updated.note, "기타");
  assert.equal(updated.amountKrw, 3000);
}));

test("blocks records owned by another inventory", () => withDatabase((database) => {
  const first = inventory(database);
  const second = inventory(database);
  const repair = addRepairLog(database, {
    inventoryItemId: first.id,
    type: "세척",
    costKrw: 1000,
    performedAt: "2026-09-20T10:00:00Z",
  });
  const expense = addExpense(database, {
    inventoryItemId: first.id,
    category: "OTHER",
    amountKrw: 1000,
    occurredAt: "2026-09-20T10:00:00Z",
  });
  assert.throws(
    () => updateRepairRecord(database, second.id, repair.id, { costKrw: 2 }),
    /does not belong to inventory item/,
  );
  assert.throws(
    () => updateExpenseRecord(database, second.id, expense.id, { amountKrw: 2 }),
    /does not belong to inventory item/,
  );
}));

test("rejects missing repair and expense ids", () => withDatabase((database) => {
  const item = inventory(database);
  assert.throws(
    () => updateRepairRecord(database, item.id, 999, { costKrw: 2 }),
    new Error("Repair log not found: 999"),
  );
  assert.throws(
    () => updateExpenseRecord(database, item.id, 999, { amountKrw: 2 }),
    new Error("Expense not found: 999"),
  );
}));
