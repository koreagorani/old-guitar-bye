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
  updateInventoryExpectedSalePrice,
  updateInventoryPurchasePrice,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-price-update-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function fixture(database) {
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: "price-update-source",
    url: "https://example.com/price-update-source",
    title: "Yamaha F310",
    description: "Playable used guitar",
    askingPriceKrw: 50000,
    sellerLocationText: "Seoul",
    discoveredAt: "2026-09-25T00:00:00Z",
    lastSeenAt: "2026-09-25T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
    boughtAt: "2026-09-25T01:00:00Z",
    agreedPurchasePriceKrw: 40000,
  });
  acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-25T02:00:00Z",
  });
  return createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode: "G-0001",
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-25T02:00:00Z",
    expectedSalePriceKrw: 90000,
  });
}

test("updates purchase price without changing inventory state", () => withDatabase((database) => {
  const inventory = fixture(database);
  const updated = updateInventoryPurchasePrice(database, inventory.id, 55000);
  assert.equal(updated.purchasePriceKrw, 55000);
  assert.equal(updated.state, inventory.state);
}));

test("updates expected sale price without changing inventory state", () => withDatabase((database) => {
  const inventory = fixture(database);
  const updated = updateInventoryExpectedSalePrice(database, inventory.id, 120000);
  assert.equal(updated.expectedSalePriceKrw, 120000);
  assert.equal(updated.state, inventory.state);
}));

test("rejects invalid purchase and expected sale prices", () => withDatabase((database) => {
  const inventory = fixture(database);
  assert.throws(
    () => updateInventoryPurchasePrice(database, inventory.id, -1),
    /purchasePriceKrw must be a non-negative safe integer/,
  );
  assert.throws(
    () => updateInventoryExpectedSalePrice(database, inventory.id, -1),
    /expectedSalePriceKrw must be a non-negative safe integer or null/,
  );
}));

test("rejects price updates for a missing inventory item", () => withDatabase((database) => {
  assert.throws(
    () => updateInventoryPurchasePrice(database, 999, 50000),
    new Error("Inventory item not found: 999"),
  );
  assert.throws(
    () => updateInventoryExpectedSalePrice(database, 999, 90000),
    new Error("Inventory item not found: 999"),
  );
}));
