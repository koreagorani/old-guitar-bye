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
  createInventoryItem,
  findInventoryItemByAcquisitionId,
  findInventoryItemByCode,
  findInventoryItemById,
  updateInventoryState,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-repository-"));
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

function createAcquisitionFixture(database, status = "RECEIVED") {
  fixtureNumber += 1;
  const externalListingId = `inventory-listing-${fixtureNumber}`;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId,
    url: `https://example.com/${externalListingId}`,
    title: "Yamaha F310",
    description: "Playable used guitar",
    askingPriceKrw: 50000,
    sellerLocationText: "Seoul",
    discoveredAt: "2026-09-12T00:00:00Z",
    lastSeenAt: "2026-09-12T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  if (status === "BUYING" || status === "RECEIVED") {
    acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
      boughtAt: "2026-09-13T00:00:00Z",
      agreedPurchasePriceKrw: 40000,
    });
  }
  if (status === "RECEIVED") {
    acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
      receivedAt: "2026-09-14T00:00:00Z",
    });
  }
  return acquisition;
}

function inventoryData(acquisitionId, inventoryCode = "G-0001") {
  return {
    acquisitionId,
    inventoryCode,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    serialNumber: null,
    storageLocation: "workshop",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-14T00:00:00Z",
    expectedSalePriceKrw: 90000,
    note: "first inspection pending",
  };
}

function createInventoryFixture(database, inventoryCode = "G-0001") {
  const acquisition = createAcquisitionFixture(database);
  const inventoryItem = createInventoryItem(
    database,
    inventoryData(acquisition.id, inventoryCode),
  );
  return { acquisition, inventoryItem };
}

test("creates an inventory item from a RECEIVED acquisition", () => withDatabase((database) => {
  const { acquisition, inventoryItem } = createInventoryFixture(database);
  assert.equal(inventoryItem.acquisitionId, acquisition.id);
}));

test("creates an inventory item in IN_STOCK state", () => withDatabase((database) => {
  const { inventoryItem } = createInventoryFixture(database);
  assert.equal(inventoryItem.state, "IN_STOCK");
}));

test("does not allow the caller to choose an initial state", () => withDatabase((database) => {
  const acquisition = createAcquisitionFixture(database);
  assert.throws(
    () => createInventoryItem(database, {
      ...inventoryData(acquisition.id),
      state: "SOLD",
    }),
    /state is fixed to IN_STOCK/,
  );
}));

for (const status of ["FOUND", "BUYING"]) {
  test(`rejects inventory creation from a ${status} acquisition`, () => withDatabase((database) => {
    const acquisition = createAcquisitionFixture(database, status);
    assert.throws(
      () => createInventoryItem(database, inventoryData(acquisition.id)),
      /requires a RECEIVED acquisition/,
    );
    assert.equal(findInventoryItemByAcquisitionId(database, acquisition.id), null);
  }));
}

test("rejects a second inventory item for the same acquisition", () => withDatabase((database) => {
  const { acquisition } = createInventoryFixture(database);
  assert.throws(
    () => createInventoryItem(database, inventoryData(acquisition.id, "G-0002")),
    /UNIQUE constraint failed/,
  );
}));

test("rejects a duplicate inventory code", () => withDatabase((database) => {
  createInventoryFixture(database, "G-0001");
  const acquisition = createAcquisitionFixture(database);
  assert.throws(
    () => createInventoryItem(database, inventoryData(acquisition.id, "G-0001")),
    /UNIQUE constraint failed/,
  );
}));

test("finds an inventory item by id", () => withDatabase((database) => {
  const { inventoryItem } = createInventoryFixture(database);
  assert.deepEqual(findInventoryItemById(database, inventoryItem.id), inventoryItem);
}));

test("finds an inventory item by inventory code", () => withDatabase((database) => {
  const { inventoryItem } = createInventoryFixture(database);
  assert.deepEqual(findInventoryItemByCode(database, "G-0001"), inventoryItem);
}));

test("finds an inventory item by acquisition id", () => withDatabase((database) => {
  const { acquisition, inventoryItem } = createInventoryFixture(database);
  assert.deepEqual(
    findInventoryItemByAcquisitionId(database, acquisition.id),
    inventoryItem,
  );
}));

test("returns null when an inventory item does not exist", () => withDatabase((database) => {
  assert.equal(findInventoryItemById(database, 999), null);
  assert.equal(findInventoryItemByCode(database, "G-9999"), null);
  assert.equal(findInventoryItemByAcquisitionId(database, 999), null);
}));

test("uses the domain state machine for valid transitions", () => withDatabase((database) => {
  const { inventoryItem } = createInventoryFixture(database);
  const repairing = updateInventoryState(database, inventoryItem.id, "REPAIRING");
  const forSale = updateInventoryState(database, inventoryItem.id, "FOR_SALE");
  const sold = updateInventoryState(database, inventoryItem.id, "SOLD");
  assert.equal(repairing.state, "REPAIRING");
  assert.equal(forSale.state, "FOR_SALE");
  assert.equal(sold.state, "SOLD");
}));

test("rejects an invalid inventory transition", () => withDatabase((database) => {
  const { inventoryItem } = createInventoryFixture(database);
  assert.throws(
    () => updateInventoryState(database, inventoryItem.id, "SOLD"),
    new Error("Invalid inventory transition: IN_STOCK -> SOLD"),
  );
}));

test("leaves state unchanged after a failed transition", () => withDatabase((database) => {
  const { inventoryItem } = createInventoryFixture(database);
  assert.throws(
    () => updateInventoryState(database, inventoryItem.id, "SOLD"),
  );
  assert.equal(findInventoryItemById(database, inventoryItem.id).state, "IN_STOCK");
}));

test("rejects a missing acquisition", () => withDatabase((database) => {
  assert.throws(
    () => createInventoryItem(database, inventoryData(999999)),
    new Error("Acquisition not found: 999999"),
  );
}));

test("rejects a negative purchase price", () => withDatabase((database) => {
  const acquisition = createAcquisitionFixture(database);
  assert.throws(
    () => createInventoryItem(database, {
      ...inventoryData(acquisition.id),
      purchasePriceKrw: -1,
    }),
    /purchasePriceKrw must be a non-negative safe integer/,
  );
}));

test("enforces the inventory item acquisition foreign key", () => withDatabase((database) => {
  assert.throws(
    () => database.prepare(`
      INSERT INTO inventory_items (
        inventory_code, acquisition_id, brand, model_name, guitar_type,
        state, purchase_price_krw, received_at
      ) VALUES ('G-FK', 999999, 'Yamaha', 'F310', 'ACOUSTIC',
        'IN_STOCK', 40000, '2026-09-14T00:00:00Z')
    `).run(),
    /FOREIGN KEY constraint failed/,
  );
}));

test("rejects an update for an inventory item that does not exist", () => withDatabase((database) => {
  assert.throws(
    () => updateInventoryState(database, 999, "REPAIRING"),
    new Error("Inventory item not found: 999"),
  );
}));
