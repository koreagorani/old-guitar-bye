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
  closeSaleListing,
  createSaleListing,
  findSaleListingById,
  listSaleListingsByInventoryItemId,
} from "../../src/repositories/sale-listing-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "sale-listing-repository-"));
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
    externalListingId: `source-listing-${suffix}`,
    url: `https://example.com/source-listing-${suffix}`,
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

function saleListingData(inventoryItemId, overrides = {}) {
  return {
    inventoryItemId,
    marketplace: "daangn",
    askingPriceKrw: 90000,
    listedAt: "2026-09-15T09:00:00Z",
    closedAt: null,
    url: "https://example.com/sale-1",
    externalListingId: "sale-1",
    ...overrides,
  };
}

test("creates a sale listing", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const saleListing = createSaleListing(
    database,
    saleListingData(inventoryItem.id),
  );

  assert.deepEqual(saleListing, {
    id: saleListing.id,
    inventoryItemId: inventoryItem.id,
    marketplace: "daangn",
    askingPriceKrw: 90000,
    listedAt: "2026-09-15T09:00:00Z",
    closedAt: null,
    url: "https://example.com/sale-1",
    externalListingId: "sale-1",
  });
}));

test("finds a sale listing by id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const saleListing = createSaleListing(
    database,
    saleListingData(inventoryItem.id),
  );

  assert.deepEqual(findSaleListingById(database, saleListing.id), saleListing);
}));

test("returns null when a sale listing does not exist", () => withDatabase((database) => {
  assert.equal(findSaleListingById(database, 999), null);
}));

test("lists sale listings for an inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const saleListing = createSaleListing(
    database,
    saleListingData(inventoryItem.id),
  );

  assert.deepEqual(
    listSaleListingsByInventoryItemId(database, inventoryItem.id),
    [saleListing],
  );
}));

test("allows multiple marketplaces for one inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  createSaleListing(database, saleListingData(inventoryItem.id));
  createSaleListing(database, saleListingData(inventoryItem.id, {
    marketplace: "bunjang",
    url: "https://example.com/sale-2",
    externalListingId: "sale-2",
  }));

  assert.equal(
    listSaleListingsByInventoryItemId(database, inventoryItem.id).length,
    2,
  );
}));

test("orders sale listings by listedAt and then id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const secondAtSameTime = createSaleListing(
    database,
    saleListingData(inventoryItem.id, {
      marketplace: "daangn",
      listedAt: "2026-09-15T10:00:00Z",
    }),
  );
  const first = createSaleListing(database, saleListingData(inventoryItem.id, {
    marketplace: "bunjang",
    listedAt: "2026-09-15T08:00:00Z",
  }));
  const firstAtSameTime = createSaleListing(
    database,
    saleListingData(inventoryItem.id, {
      marketplace: "used-nara",
      listedAt: "2026-09-15T10:00:00Z",
    }),
  );

  assert.deepEqual(
    listSaleListingsByInventoryItemId(database, inventoryItem.id),
    [first, secondAtSameTime, firstAtSameTime],
  );
}));

test("rejects a missing inventory item", () => withDatabase((database) => {
  assert.throws(
    () => createSaleListing(database, saleListingData(999999)),
    new Error("Inventory item not found: 999999"),
  );
}));

test("rejects a negative asking price", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => createSaleListing(database, saleListingData(inventoryItem.id, {
      askingPriceKrw: -1,
    })),
    /askingPriceKrw must be a non-negative safe integer/,
  );
}));

test("allows a zero asking price", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const saleListing = createSaleListing(
    database,
    saleListingData(inventoryItem.id, { askingPriceKrw: 0 }),
  );
  assert.equal(saleListing.askingPriceKrw, 0);
}));

test("requires listedAt", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => createSaleListing(database, saleListingData(inventoryItem.id, {
      listedAt: "",
    })),
    /listedAt must be a non-empty string/,
  );
}));

test("closes a sale listing and stores closedAt", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const saleListing = createSaleListing(
    database,
    saleListingData(inventoryItem.id),
  );
  const closed = closeSaleListing(
    database,
    saleListing.id,
    "2026-09-20T12:00:00Z",
  );

  assert.equal(closed.closedAt, "2026-09-20T12:00:00Z");
  assert.deepEqual(findSaleListingById(database, saleListing.id), closed);
}));

test("rejects closing a missing sale listing", () => withDatabase((database) => {
  assert.throws(
    () => closeSaleListing(database, 999, "2026-09-20T12:00:00Z"),
    new Error("Sale listing not found: 999"),
  );
}));

test("does not mix sale listings from different inventory items", () => withDatabase((database) => {
  const firstInventoryItem = createInventoryFixture(database);
  const secondInventoryItem = createInventoryFixture(database);
  const firstSaleListing = createSaleListing(
    database,
    saleListingData(firstInventoryItem.id),
  );
  createSaleListing(database, saleListingData(secondInventoryItem.id, {
    marketplace: "bunjang",
  }));

  assert.deepEqual(
    listSaleListingsByInventoryItemId(database, firstInventoryItem.id),
    [firstSaleListing],
  );
}));

test("returns an empty list when an inventory item has no sale listings", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.deepEqual(
    listSaleListingsByInventoryItemId(database, inventoryItem.id),
    [],
  );
}));

test("does not change inventory state when creating a sale listing", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  createSaleListing(database, saleListingData(inventoryItem.id));

  assert.equal(
    findInventoryItemById(database, inventoryItem.id).state,
    "IN_STOCK",
  );
}));
