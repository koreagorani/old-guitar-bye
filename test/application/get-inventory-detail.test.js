import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getInventoryDetail } from "../../src/application/inventory/get-inventory-detail.js";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  createAcquisition,
  updateAcquisitionState,
} from "../../src/repositories/acquisition-repository.js";
import { addExpense } from "../../src/repositories/expense-repository.js";
import { createInventoryItem } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { addRepairLog } from "../../src/repositories/repair-repository.js";
import { createSaleListing } from "../../src/repositories/sale-listing-repository.js";
import { createSale } from "../../src/repositories/sale-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-detail-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function snapshotLedger(database) {
  const tables = [
    "listings",
    "acquisitions",
    "inventory_items",
    "repair_logs",
    "expenses",
    "sale_listings",
    "sales",
  ];

  return Object.fromEntries(tables.map((table) => [
    table,
    database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
      .map((row) => ({ ...row })),
  ]));
}

let fixtureNumber = 0;

function createInventoryFixture(database, overrides = {}) {
  fixtureNumber += 1;
  const suffix = fixtureNumber;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `inventory-detail-source-${suffix}`,
    url: `https://example.com/source-${suffix}`,
    title: "Yamaha F310",
    description: "Playable used guitar",
    askingPriceKrw: 50000,
    sellerLocationText: "Seoul",
    discoveredAt: "2026-09-01T00:00:00Z",
    lastSeenAt: "2026-09-01T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
    agreedPurchasePriceKrw: 40000,
    boughtAt: "2026-09-02T00:00:00Z",
  });
  acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-03T00:00:00Z",
  });
  const inventory = createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode: `G-${String(suffix).padStart(4, "0")}`,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-03T00:00:00Z",
    expectedSalePriceKrw: 90000,
    ...overrides,
  });

  return { acquisition, inventory };
}

function addDetailRecords(database, inventoryItemId) {
  const repairs = [
    addRepairLog(database, {
      inventoryItemId,
      type: "CLEANING",
      costKrw: 0,
      minutesSpent: 15,
      performedAt: "2026-09-04T09:00:00Z",
    }),
    addRepairLog(database, {
      inventoryItemId,
      type: "STRING_CHANGE",
      costKrw: 8000,
      minutesSpent: 10,
      performedAt: "2026-09-05T09:00:00Z",
    }),
  ];
  const expenses = [
    addExpense(database, {
      inventoryItemId,
      category: "LOGISTICS",
      amountKrw: 3000,
      occurredAt: "2026-09-03T12:00:00Z",
    }),
    addExpense(database, {
      inventoryItemId,
      category: "PACKAGING",
      amountKrw: 1000,
      occurredAt: "2026-09-06T12:00:00Z",
    }),
  ];
  const saleListings = [
    createSaleListing(database, {
      inventoryItemId,
      marketplace: "daangn",
      askingPriceKrw: 90000,
      listedAt: "2026-09-07T09:00:00Z",
    }),
    createSaleListing(database, {
      inventoryItemId,
      marketplace: "bunjang",
      askingPriceKrw: 88000,
      listedAt: "2026-09-08T09:00:00Z",
    }),
  ];

  return { repairs, expenses, saleListings };
}

test("includes the inventory item", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  const detail = getInventoryDetail(database, inventory.id);

  assert.deepEqual(detail.inventory, inventory);
}));

test("includes the acquisition", () => withDatabase((database) => {
  const { acquisition, inventory } = createInventoryFixture(database);
  const detail = getInventoryDetail(database, inventory.id);

  assert.deepEqual(detail.acquisition, acquisition);
}));

test("includes multiple repair logs", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  const { repairs } = addDetailRecords(database, inventory.id);

  assert.deepEqual(getInventoryDetail(database, inventory.id).repairs, repairs);
}));

test("includes multiple expenses", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  const { expenses } = addDetailRecords(database, inventory.id);

  assert.deepEqual(getInventoryDetail(database, inventory.id).expenses, expenses);
}));

test("includes multiple sale listings", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  const { saleListings } = addDetailRecords(database, inventory.id);

  assert.deepEqual(
    getInventoryDetail(database, inventory.id).saleListings,
    saleListings,
  );
}));

test("returns null for sale when the guitar has not sold", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);

  assert.equal(getInventoryDetail(database, inventory.id).sale, null);
}));

test("includes the sale when the guitar has sold", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  const sale = createSale(database, {
    inventoryItemId: inventory.id,
    marketplace: "direct",
    salePriceKrw: 85000,
    soldAt: "2026-09-10T12:00:00Z",
  });

  assert.deepEqual(getInventoryDetail(database, inventory.id).sale, sale);
}));

test("calculates total inventory cost", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  addDetailRecords(database, inventory.id);

  assert.deepEqual(getInventoryDetail(database, inventory.id).cost, {
    purchasePriceKrw: 40000,
    repairCostTotalKrw: 8000,
    expenseCostTotalKrw: 4000,
    totalCostKrw: 52000,
    expectedProfitKrw: 38000,
    realizedProfitKrw: null,
  });
}));

test("calculates expected profit", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  addDetailRecords(database, inventory.id);

  assert.equal(
    getInventoryDetail(database, inventory.id).cost.expectedProfitKrw,
    38000,
  );
}));

test("calculates realized profit from the sale", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  addDetailRecords(database, inventory.id);
  createSale(database, {
    inventoryItemId: inventory.id,
    marketplace: "direct",
    salePriceKrw: 85000,
    soldAt: "2026-09-10T12:00:00Z",
  });

  assert.equal(
    getInventoryDetail(database, inventory.id).cost.realizedProfitKrw,
    33000,
  );
}));

test("handles an inventory item without repairs or expenses", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  const detail = getInventoryDetail(database, inventory.id);

  assert.deepEqual(detail.repairs, []);
  assert.deepEqual(detail.expenses, []);
  assert.equal(detail.cost.totalCostKrw, 40000);
}));

test("returns null when the inventory item does not exist", () => withDatabase((database) => {
  assert.equal(getInventoryDetail(database, 999999), null);
}));

test("does not mix records from another inventory item", () => withDatabase((database) => {
  const first = createInventoryFixture(database);
  const second = createInventoryFixture(database);
  addDetailRecords(database, first.inventory.id);

  const detail = getInventoryDetail(database, second.inventory.id);
  assert.deepEqual(detail.repairs, []);
  assert.deepEqual(detail.expenses, []);
  assert.deepEqual(detail.saleListings, []);
  assert.equal(detail.sale, null);
  assert.equal(detail.cost.totalCostKrw, 40000);
}));

test("does not change database state while reading details", () => withDatabase((database) => {
  const { inventory } = createInventoryFixture(database);
  addDetailRecords(database, inventory.id);
  const before = snapshotLedger(database);

  getInventoryDetail(database, inventory.id);

  assert.deepEqual(snapshotLedger(database), before);
}));
