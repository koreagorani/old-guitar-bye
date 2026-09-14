import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completeSale } from "../../src/application/sales/complete-sale.js";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  createAcquisition,
  updateAcquisitionState,
} from "../../src/repositories/acquisition-repository.js";
import {
  createInventoryItem,
  findInventoryItemById,
  updateInventoryState,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import {
  closeSaleListing,
  createSaleListing,
  findSaleListingById,
} from "../../src/repositories/sale-listing-repository.js";
import {
  findSaleByInventoryItemId,
} from "../../src/repositories/sale-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "complete-sale-"));
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

function createInventoryFixture(database, state = "FOR_SALE") {
  fixtureNumber += 1;
  const suffix = fixtureNumber;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `complete-sale-source-${suffix}`,
    url: `https://example.com/complete-sale-source-${suffix}`,
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
  let inventoryItem = createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode: `G-${String(suffix).padStart(4, "0")}`,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-14T00:00:00Z",
  });

  if (state === "REPAIRING") {
    inventoryItem = updateInventoryState(
      database,
      inventoryItem.id,
      "REPAIRING",
    );
  } else if (state === "FOR_SALE") {
    inventoryItem = updateInventoryState(
      database,
      inventoryItem.id,
      "FOR_SALE",
    );
  }

  return inventoryItem;
}

function createSaleListingFixture(database, inventoryItemId) {
  return createSaleListing(database, {
    inventoryItemId,
    marketplace: "daangn",
    askingPriceKrw: 90000,
    listedAt: "2026-09-15T09:00:00Z",
    url: "https://example.com/sale-listing",
    externalListingId: `complete-sale-listing-${inventoryItemId}`,
  });
}

function completeSaleData(inventoryItemId, saleListingId = null) {
  return {
    inventoryItemId,
    saleListingId,
    marketplace: "daangn",
    salePriceKrw: 85000,
    soldAt: "2026-09-20T12:00:00Z",
    note: "Met buyer in person",
  };
}

function createSaleReadyFixture(database) {
  const inventoryItem = createInventoryFixture(database);
  const saleListing = createSaleListingFixture(database, inventoryItem.id);
  return { inventoryItem, saleListing };
}

function forceSoldUpdateFailure(database) {
  database.exec(`
    CREATE TRIGGER test_fail_sold_update
    BEFORE UPDATE OF state ON inventory_items
    WHEN NEW.state = 'SOLD'
    BEGIN
      SELECT RAISE(ABORT, 'forced inventory update failure');
    END;
  `);
}

test("completes a sale for a FOR_SALE inventory item", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  const result = completeSale(
    database,
    completeSaleData(inventoryItem.id, saleListing.id),
  );

  assert.equal(result.sale.inventoryItemId, inventoryItem.id);
  assert.equal(result.saleListing.id, saleListing.id);
  assert.equal(result.inventoryItem.state, "SOLD");
}));

test("creates the sale record", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  const result = completeSale(
    database,
    completeSaleData(inventoryItem.id, saleListing.id),
  );

  assert.deepEqual(
    findSaleByInventoryItemId(database, inventoryItem.id),
    result.sale,
  );
}));

test("closes the connected sale listing at soldAt", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  completeSale(
    database,
    completeSaleData(inventoryItem.id, saleListing.id),
  );

  assert.equal(
    findSaleListingById(database, saleListing.id).closedAt,
    "2026-09-20T12:00:00Z",
  );
}));

test("changes inventory state to SOLD", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  completeSale(
    database,
    completeSaleData(inventoryItem.id, saleListing.id),
  );

  assert.equal(findInventoryItemById(database, inventoryItem.id).state, "SOLD");
}));

test("completes a direct sale without a sale listing", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const result = completeSale(
    database,
    completeSaleData(inventoryItem.id, null),
  );

  assert.equal(result.sale.saleListingId, null);
  assert.equal(result.saleListing, null);
  assert.equal(result.inventoryItem.state, "SOLD");
}));

for (const state of ["IN_STOCK", "REPAIRING"]) {
  test(`rejects completing a sale from ${state}`, () => withDatabase((database) => {
    const inventoryItem = createInventoryFixture(database, state);
    assert.throws(
      () => completeSale(database, completeSaleData(inventoryItem.id)),
      new Error(`Invalid inventory transition: ${state} -> SOLD`),
    );
    assert.equal(findSaleByInventoryItemId(database, inventoryItem.id), null);
  }));
}

test("rejects a missing inventory item", () => withDatabase((database) => {
  assert.throws(
    () => completeSale(database, completeSaleData(999999)),
    new Error("Inventory item not found: 999999"),
  );
}));

test("rejects a missing sale listing", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => completeSale(database, completeSaleData(inventoryItem.id, 999999)),
    new Error("Sale listing not found: 999999"),
  );
  assert.equal(findSaleByInventoryItemId(database, inventoryItem.id), null);
}));

test("rejects another inventory item's sale listing", () => withDatabase((database) => {
  const firstInventoryItem = createInventoryFixture(database);
  const secondInventoryItem = createInventoryFixture(database);
  const secondSaleListing = createSaleListingFixture(
    database,
    secondInventoryItem.id,
  );

  assert.throws(
    () => completeSale(
      database,
      completeSaleData(firstInventoryItem.id, secondSaleListing.id),
    ),
    new Error(
      `Sale listing ${secondSaleListing.id} does not belong to inventory item ${firstInventoryItem.id}`,
    ),
  );
}));

test("rejects an already closed sale listing", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  closeSaleListing(database, saleListing.id, "2026-09-19T12:00:00Z");

  assert.throws(
    () => completeSale(
      database,
      completeSaleData(inventoryItem.id, saleListing.id),
    ),
    new Error(`Sale listing already closed: ${saleListing.id}`),
  );
  assert.equal(
    findSaleListingById(database, saleListing.id).closedAt,
    "2026-09-19T12:00:00Z",
  );
}));

test("rolls back the sale when the final inventory update fails", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  forceSoldUpdateFailure(database);

  assert.throws(
    () => completeSale(
      database,
      completeSaleData(inventoryItem.id, saleListing.id),
    ),
    /forced inventory update failure/,
  );
  assert.equal(findSaleByInventoryItemId(database, inventoryItem.id), null);
}));

test("keeps inventory state after a rolled back sale", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  forceSoldUpdateFailure(database);

  assert.throws(() => completeSale(
    database,
    completeSaleData(inventoryItem.id, saleListing.id),
  ));
  assert.equal(
    findInventoryItemById(database, inventoryItem.id).state,
    "FOR_SALE",
  );
}));

test("keeps sale listing open after a rolled back sale", () => withDatabase((database) => {
  const { inventoryItem, saleListing } = createSaleReadyFixture(database);
  forceSoldUpdateFailure(database);

  assert.throws(() => completeSale(
    database,
    completeSaleData(inventoryItem.id, saleListing.id),
  ));
  assert.equal(findSaleListingById(database, saleListing.id).closedAt, null);
}));

test("rejects completing a second sale for the same inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  completeSale(database, completeSaleData(inventoryItem.id));

  assert.throws(
    () => completeSale(database, completeSaleData(inventoryItem.id)),
    new Error("Invalid inventory transition: SOLD -> SOLD"),
  );
  assert.ok(findSaleByInventoryItemId(database, inventoryItem.id));
}));
