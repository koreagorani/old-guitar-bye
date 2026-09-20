import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { registerInventory } from "../../src/application/inventory/register-inventory.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "register-inventory-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return await callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function registration(overrides = {}) {
  return {
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 20000,
    expectedSalePriceKrw: 80000,
    registeredAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  };
}

test("allocates simple sequential inventory codes", async () => withDatabase((database) => {
  const first = registerInventory(database, registration());
  const second = registerInventory(database, registration({ modelName: "F370" }));

  assert.equal(first.inventoryCode, "G-0001");
  assert.equal(second.inventoryCode, "G-0002");
}));

test("rolls back listing and acquisition when inventory creation fails", async () => withDatabase((database) => {
  assert.throws(
    () => registerInventory(database, registration({ expectedSalePriceKrw: -1 })),
    /expectedSalePriceKrw must be a non-negative safe integer or null/,
  );

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM acquisitions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_items").get().count, 0);
}));
