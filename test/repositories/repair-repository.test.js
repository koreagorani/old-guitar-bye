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
  updateInventoryState,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import {
  addRepairLog,
  findRepairLogById,
  listRepairLogsByInventoryItemId,
} from "../../src/repositories/repair-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "repair-repository-"));
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
    externalListingId: `repair-listing-${suffix}`,
    url: `https://example.com/repair-listing-${suffix}`,
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

function repairData(inventoryItemId, overrides = {}) {
  return {
    inventoryItemId,
    type: "CLEANING",
    costKrw: 0,
    minutesSpent: 15,
    note: "Body and fretboard cleaned",
    performedAt: "2026-09-14T09:00:00Z",
    ...overrides,
  };
}

test("creates a repair log", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const repairLog = addRepairLog(database, repairData(inventoryItem.id));

  assert.deepEqual(repairLog, {
    id: repairLog.id,
    inventoryItemId: inventoryItem.id,
    type: "CLEANING",
    costKrw: 0,
    minutesSpent: 15,
    note: "Body and fretboard cleaned",
    performedAt: "2026-09-14T09:00:00Z",
  });
}));

test("finds a repair log by id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const repairLog = addRepairLog(database, repairData(inventoryItem.id));

  assert.deepEqual(findRepairLogById(database, repairLog.id), repairLog);
}));

test("returns null when a repair log does not exist", () => withDatabase((database) => {
  assert.equal(findRepairLogById(database, 999), null);
}));

test("lists repair logs for an inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const repairLog = addRepairLog(database, repairData(inventoryItem.id));

  assert.deepEqual(
    listRepairLogsByInventoryItemId(database, inventoryItem.id),
    [repairLog],
  );
}));

test("orders repair logs by performedAt and then id", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const secondAtSameTime = addRepairLog(database, repairData(inventoryItem.id, {
    type: "STRING_CHANGE",
    performedAt: "2026-09-14T10:00:00Z",
  }));
  const first = addRepairLog(database, repairData(inventoryItem.id, {
    type: "NECK_ADJUSTMENT",
    performedAt: "2026-09-14T08:00:00Z",
  }));
  const firstAtSameTime = addRepairLog(database, repairData(inventoryItem.id, {
    type: "ACTION_ADJUSTMENT",
    performedAt: "2026-09-14T10:00:00Z",
  }));

  assert.deepEqual(
    listRepairLogsByInventoryItemId(database, inventoryItem.id),
    [first, secondAtSameTime, firstAtSameTime],
  );
}));

test("rejects a missing inventory item", () => withDatabase((database) => {
  assert.throws(
    () => addRepairLog(database, repairData(999999)),
    new Error("Inventory item not found: 999999"),
  );
}));

test("rejects a negative repair cost", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => addRepairLog(database, repairData(inventoryItem.id, { costKrw: -1 })),
    /costKrw must be a non-negative safe integer/,
  );
}));

test("rejects negative minutes spent", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => addRepairLog(database, repairData(inventoryItem.id, {
      minutesSpent: -1,
    })),
    /minutesSpent must be a non-negative safe integer/,
  );
}));

test("allows null minutes spent", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const repairLog = addRepairLog(database, repairData(inventoryItem.id, {
    minutesSpent: null,
  }));

  assert.equal(repairLog.minutesSpent, null);
}));

test("allows zero repair cost", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  const repairLog = addRepairLog(database, repairData(inventoryItem.id, {
    costKrw: 0,
  }));

  assert.equal(repairLog.costKrw, 0);
}));

test("allows multiple repair logs for one inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  addRepairLog(database, repairData(inventoryItem.id));
  addRepairLog(database, repairData(inventoryItem.id, {
    type: "STRING_CHANGE",
    costKrw: 8000,
  }));
  addRepairLog(database, repairData(inventoryItem.id, {
    type: "NECK_ADJUSTMENT",
    minutesSpent: 10,
  }));

  assert.equal(
    listRepairLogsByInventoryItemId(database, inventoryItem.id).length,
    3,
  );
}));

test("does not mix repair logs from different inventory items", () => withDatabase((database) => {
  const firstInventoryItem = createInventoryFixture(database);
  const secondInventoryItem = createInventoryFixture(database);
  const firstRepairLog = addRepairLog(
    database,
    repairData(firstInventoryItem.id),
  );
  addRepairLog(database, repairData(secondInventoryItem.id, {
    type: "ELECTRONICS",
  }));

  assert.deepEqual(
    listRepairLogsByInventoryItemId(database, firstInventoryItem.id),
    [firstRepairLog],
  );
}));

test("returns an empty list when an inventory item has no repair logs", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.deepEqual(
    listRepairLogsByInventoryItemId(database, inventoryItem.id),
    [],
  );
}));

test("validates the supported repair types", async (t) => {
  const repairTypes = [
    "CLEANING",
    "STRING_CHANGE",
    "NECK_ADJUSTMENT",
    "ACTION_ADJUSTMENT",
    "FRET_WORK",
    "ELECTRONICS",
    "OTHER",
  ];

  for (const type of repairTypes) {
    await t.test(type, () => withDatabase((database) => {
      const inventoryItem = createInventoryFixture(database);
      assert.equal(
        addRepairLog(database, repairData(inventoryItem.id, { type })).type,
        type,
      );
    }));
  }
});

test("rejects an unknown repair type", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  assert.throws(
    () => addRepairLog(database, repairData(inventoryItem.id, {
      type: "UNKNOWN",
    })),
    new TypeError("Unknown repair type: UNKNOWN"),
  );
}));

test("allows adding a historical repair log to a SOLD inventory item", () => withDatabase((database) => {
  const inventoryItem = createInventoryFixture(database);
  updateInventoryState(database, inventoryItem.id, "FOR_SALE");
  updateInventoryState(database, inventoryItem.id, "SOLD");

  const repairLog = addRepairLog(database, repairData(inventoryItem.id));
  assert.equal(repairLog.inventoryItemId, inventoryItem.id);
}));
