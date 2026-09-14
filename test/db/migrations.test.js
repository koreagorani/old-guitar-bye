import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";

function insertListing(database, externalListingId) {
  return Number(database.prepare(`
    INSERT INTO listings (
      marketplace, external_listing_id, url, title, description,
      asking_price_krw, seller_location_text, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "example-market",
    externalListingId,
    `https://example.com/${externalListingId}`,
    "Used guitar",
    "Playable used guitar",
    50000,
    "Seoul",
    "2026-09-12T00:00:00Z",
    "2026-09-12T00:00:00Z",
  ).lastInsertRowid);
}

function insertAcquisition(database, listingId, status = "RECEIVED") {
  return Number(database.prepare(`
    INSERT INTO acquisitions (
      listing_id, status, agreed_purchase_price_krw, bought_at, received_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    listingId,
    status,
    status === "FOUND" ? null : 40000,
    status === "FOUND" ? null : "2026-09-12T01:00:00Z",
    status === "RECEIVED" ? "2026-09-12T02:00:00Z" : null,
  ).lastInsertRowid);
}

function insertInventoryItem(database, acquisitionId, inventoryCode) {
  return Number(database.prepare(`
    INSERT INTO inventory_items (
      inventory_code, acquisition_id, brand, model_name, guitar_type,
      state, purchase_price_krw, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    inventoryCode,
    acquisitionId,
    "Yamaha",
    "F310",
    "ACOUSTIC",
    "IN_STOCK",
    40000,
    "2026-09-12T02:00:00Z",
  ).lastInsertRowid);
}

test("initial migration creates and constrains the MVP ledger", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "old-guitar-bye-"));
  const database = openDatabase(join(directory, "test.sqlite"));

  try {
    const applied = applyMigrations(database);

    await t.test("migrates an empty database", () => {
      assert.deepEqual(applied, [
        "001_initial.sql",
        "002_add_sale_listing_external_id.sql",
      ]);
      assert.deepEqual(applyMigrations(database), []);
    });

    await t.test("adds external listing id to sale listings", () => {
      const columns = database.prepare(
        "PRAGMA table_info(sale_listings)",
      ).all().map(({ name }) => name);
      assert.ok(columns.includes("external_listing_id"));
    });

    await t.test("creates every table", () => {
      const actualTables = database.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all().map(({ name }) => name);
      assert.deepEqual(actualTables, [
        "acquisitions",
        "expenses",
        "inventory_items",
        "listings",
        "repair_logs",
        "sale_listings",
        "sales",
        "schema_migrations",
      ]);
    });

    const listingId = insertListing(database, "listing-1");

    await t.test("prevents duplicate marketplace listings", () => {
      assert.throws(
        () => insertListing(database, "listing-1"),
        /UNIQUE constraint failed/,
      );
    });

    await t.test("rejects an invalid foreign key", () => {
      assert.throws(
        () => database.prepare(`
          INSERT INTO acquisitions (listing_id, status) VALUES (?, ?)
        `).run(999999, "FOUND"),
        /FOREIGN KEY constraint failed/,
      );
    });

    const acquisitionId = insertAcquisition(database, listingId, "RECEIVED");

    await t.test("links an acquisition to its listing", () => {
      const row = database.prepare(`
        SELECT a.status, l.external_listing_id
        FROM acquisitions a
        JOIN listings l ON l.id = a.listing_id
        WHERE a.id = ?
      `).get(acquisitionId);
      assert.deepEqual({ ...row }, {
        status: "RECEIVED",
        external_listing_id: "listing-1",
      });
    });

    const inventoryItemId = insertInventoryItem(database, acquisitionId, "G-0001");

    await t.test("links an inventory item to its acquisition", () => {
      const row = database.prepare(`
        SELECT i.inventory_code, a.status
        FROM inventory_items i
        JOIN acquisitions a ON a.id = i.acquisition_id
        WHERE i.id = ?
      `).get(inventoryItemId);
      assert.deepEqual({ ...row }, {
        inventory_code: "G-0001",
        status: "RECEIVED",
      });
    });

    await t.test("keeps inventory codes unique", () => {
      const secondListingId = insertListing(database, "listing-2");
      const secondAcquisitionId = insertAcquisition(database, secondListingId);
      assert.throws(
        () => insertInventoryItem(database, secondAcquisitionId, "G-0001"),
        /UNIQUE constraint failed/,
      );
    });

    await t.test("allows only one final sale per inventory item", () => {
      const insertSale = database.prepare(`
        INSERT INTO sales (
          inventory_item_id, sale_price_krw, sold_at, marketplace
        ) VALUES (?, ?, ?, ?)
      `);
      insertSale.run(inventoryItemId, 90000, "2026-09-15T00:00:00Z", "example-market");
      assert.throws(
        () => insertSale.run(
          inventoryItemId,
          95000,
          "2026-09-16T00:00:00Z",
          "another-market",
        ),
        /UNIQUE constraint failed/,
      );
    });

    await t.test("restricts acquisition and inventory states", () => {
      const thirdListingId = insertListing(database, "listing-3");
      assert.throws(
        () => insertAcquisition(database, thirdListingId, "REVIEWING"),
        /CHECK constraint failed/,
      );
      assert.throws(
        () => database.prepare(`
          UPDATE inventory_items SET state = 'LISTED' WHERE id = ?
        `).run(inventoryItemId),
        /CHECK constraint failed/,
      );
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
