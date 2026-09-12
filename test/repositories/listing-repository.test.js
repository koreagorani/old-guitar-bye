import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  findListingByExternalId,
  findListingById,
  saveOrUpdateListing,
} from "../../src/repositories/listing-repository.js";

function createListing(overrides = {}) {
  return {
    marketplace: "daangn",
    externalListingId: "listing-1",
    url: "https://example.com/listing-1",
    title: "Yamaha F310",
    description: "Playable used guitar",
    askingPriceKrw: 50000,
    sellerLocationText: "Seoul",
    discoveredAt: "2026-09-12T00:00:00Z",
    lastSeenAt: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "listing-repository-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("saves a new listing", () => withDatabase((database) => {
  const saved = saveOrUpdateListing(database, createListing());
  assert.equal(saved.id, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 1);
}));

test("finds a saved listing by id", () => withDatabase((database) => {
  const listing = createListing();
  const saved = saveOrUpdateListing(database, listing);
  assert.deepEqual(findListingById(database, saved.id), { id: saved.id, ...listing });
}));

test("keeps one row when the same listing is saved again", () => withDatabase((database) => {
  const first = saveOrUpdateListing(database, createListing());
  const second = saveOrUpdateListing(database, createListing({
    lastSeenAt: "2026-09-13T00:00:00Z",
  }));
  assert.equal(second.id, first.id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 1);
}));

test("updates the asking price when a listing is seen again", () => withDatabase((database) => {
  saveOrUpdateListing(database, createListing());
  const updated = saveOrUpdateListing(database, createListing({
    askingPriceKrw: 45000,
    lastSeenAt: "2026-09-13T00:00:00Z",
  }));
  assert.equal(updated.askingPriceKrw, 45000);
}));

test("updates the title when a listing is seen again", () => withDatabase((database) => {
  saveOrUpdateListing(database, createListing());
  const updated = saveOrUpdateListing(database, createListing({
    title: "Yamaha F310 acoustic guitar",
    lastSeenAt: "2026-09-13T00:00:00Z",
  }));
  assert.equal(updated.title, "Yamaha F310 acoustic guitar");
}));

test("preserves the original discoveredAt", () => withDatabase((database) => {
  const original = saveOrUpdateListing(database, createListing());
  const updated = saveOrUpdateListing(database, createListing({
    discoveredAt: "2026-09-13T00:00:00Z",
    lastSeenAt: "2026-09-13T00:00:00Z",
  }));
  assert.equal(updated.discoveredAt, original.discoveredAt);
}));

test("updates lastSeenAt", () => withDatabase((database) => {
  saveOrUpdateListing(database, createListing());
  const updated = saveOrUpdateListing(database, createListing({
    lastSeenAt: "2026-09-13T00:00:00Z",
  }));
  assert.equal(updated.lastSeenAt, "2026-09-13T00:00:00Z");
}));

test("stores the same external id from another marketplace separately", () => withDatabase((database) => {
  const first = saveOrUpdateListing(database, createListing());
  const second = saveOrUpdateListing(database, createListing({
    marketplace: "bungaejangter",
    url: "https://example.com/other-listing-1",
  }));
  assert.notEqual(second.id, first.id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 2);
}));

test("validates required fields and rejects a negative price", async (t) => {
  const cases = [
    ["marketplace", { marketplace: "" }, TypeError],
    ["externalListingId", { externalListingId: undefined }, TypeError],
    ["title", { title: "  " }, TypeError],
    ["askingPriceKrw", { askingPriceKrw: -1 }, RangeError],
  ];

  for (const [name, override, ErrorType] of cases) {
    await t.test(name, () => withDatabase((database) => {
      assert.throws(
        () => saveOrUpdateListing(database, createListing(override)),
        ErrorType,
      );
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
    }));
  }
});

test("returns null when a listing does not exist", () => withDatabase((database) => {
  assert.equal(findListingById(database, 999), null);
  assert.equal(findListingByExternalId(database, "daangn", "missing"), null);
}));
