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
  findInventoryItemById,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import {
  createSaleListing,
} from "../../src/repositories/sale-listing-repository.js";
import {
  createSale,
  findSaleById,
  findSaleByInventoryItemId,
} from "../../src/repositories/sale-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "sale-repository-"));
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
    externalListingId: `sale-source-${suffix}`,
    url: `https://example.com/sale-source-${suffix}`,
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

function createSaleListingFixture(database, inventoryItemId) {
  return createSaleListing(database, {
    inventoryItemId,
    marketplace: "daangn",
    askingPriceKrw: 90000,
    listedAt: "2026-09-15T09:00:00Z",
    url: "https://example.com/sale-listing",
    externalListingId: `sale-listing-${inventoryItemId}`,
  });
}

function saleData(inventoryItemId, overrides = {}) {
  return {
    inventoryItemId,
    saleListingId: null,
    marketplace: "daangn",
    salePriceKrw: 85000,
    soldAt: "2026-09-20T12:00:00Z",
    note: "Met buyer in person",
    ...overrides,
  };
}

test("creates a sale", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const saleListing = createSaleListingFixture(database, inventoryItem.id);
  const sale = createSale(database, saleData(inventoryItem.id, {
    saleListingId: saleListing.id,
  }));

  assert.deepEqual(sale, {
    id: sale.id,
    inventoryItemId: inventoryItem.id,
    saleListingId: saleListing.id,
    marketplace: "daangn",
    salePriceKrw: 85000,
    soldAt: "2026-09-20T12:00:00Z",
    note: "Met buyer in person",
  });
}));

test("finds a sale by id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const sale = createSale(database, saleData(inventoryItem.id));
  assert.deepEqual(findSaleById(database, sale.id), sale);
}));

test("finds a sale by inventory item id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const sale = createSale(database, saleData(inventoryItem.id));
  assert.deepEqual(
    findSaleByInventoryItemId(database, inventoryItem.id),
    sale,
  );
}));

test("returns null when a sale does not exist", () => withDatabase((database) => {
  assert.equal(findSaleById(database, 999), null);
  assert.equal(findSaleByInventoryItemId(database, 999), null);
}));

test("rejects a second sale for the same inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  createSale(database, saleData(inventoryItem.id));
  assert.throws(
    () => createSale(database, saleData(inventoryItem.id)),
    /UNIQUE constraint failed/,
  );
}));

test("rejects a missing inventory item", () => withDatabase((database) => {
  assert.throws(
    () => createSale(database, saleData(999999)),
    new Error("Inventory item not found: 999999"),
  );
}));

test("rejects a negative sale price", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => createSale(database, saleData(inventoryItem.id, {
      salePriceKrw: -1,
    })),
    /salePriceKrw must be a non-negative safe integer/,
  );
}));

test("allows a zero sale price", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const sale = createSale(database, saleData(inventoryItem.id, {
    salePriceKrw: 0,
  }));
  assert.equal(sale.salePriceKrw, 0);
}));

test("requires soldAt", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => createSale(database, saleData(inventoryItem.id, { soldAt: "" })),
    /soldAt must be a non-empty string/,
  );
}));

test("requires marketplace", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => createSale(database, saleData(inventoryItem.id, { marketplace: "" })),
    /marketplace must be a non-empty string/,
  );
}));

test("rejects a missing sale listing", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => createSale(database, saleData(inventoryItem.id, {
      saleListingId: 999999,
    })),
    new Error("Sale listing not found: 999999"),
  );
}));

test("rejects a sale listing belonging to another inventory item", () => withDatabase((database) => {
  const firstInventoryItem = createInventoryFixture(database);
  const secondInventoryItem = createInventoryFixture(database);
  const secondSaleListing = createSaleListingFixture(
    database,
    secondInventoryItem.id,
  );

  assert.throws(
    () => createSale(database, saleData(firstInventoryItem.id, {
      saleListingId: secondSaleListing.id,
    })),
    new Error(
      `Sale listing ${secondSaleListing.id} does not belong to inventory item ${firstInventoryItem.id}`,
    ),
  );
  assert.equal(findSaleByInventoryItemId(database, firstInventoryItem.id), null);
}));

test("allows a sale without a sale listing", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const sale = createSale(database, saleData(inventoryItem.id, {
    saleListingId: null,
  }));
  assert.equal(sale.saleListingId, null);
}));

test("does not change inventory state when creating a sale", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  createSale(database, saleData(inventoryItem.id));
  assert.equal(
    findInventoryItemById(database, inventoryItem.id).state,
    "IN_STOCK",
  );
}));
