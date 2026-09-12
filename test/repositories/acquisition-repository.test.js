import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  createAcquisition,
  findAcquisitionById,
  findAcquisitionByListingId,
  updateAcquisitionState,
} from "../../src/repositories/acquisition-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "acquisition-repository-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function createListing(database, externalListingId = "listing-1") {
  return saveOrUpdateListing(database, {
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
}

function createFixture(database) {
  const listing = createListing(database);
  const acquisition = createAcquisition(database, { listingId: listing.id });
  return { listing, acquisition };
}

test("creates an acquisition for a listing", () => withDatabase((database) => {
  const listing = createListing(database);
  const acquisition = createAcquisition(database, { listingId: listing.id });
  assert.equal(acquisition.listingId, listing.id);
}));

test("creates an acquisition in FOUND state", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  assert.equal(acquisition.status, "FOUND");
}));

test("finds an acquisition by id", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  assert.deepEqual(findAcquisitionById(database, acquisition.id), acquisition);
}));

test("finds an acquisition by listing id", () => withDatabase((database) => {
  const { listing, acquisition } = createFixture(database);
  assert.deepEqual(
    findAcquisitionByListingId(database, listing.id),
    acquisition,
  );
}));

test("rejects a second acquisition for the same listing", () => withDatabase((database) => {
  const { listing } = createFixture(database);
  assert.throws(
    () => createAcquisition(database, { listingId: listing.id }),
    /UNIQUE constraint failed/,
  );
}));

test("transitions FOUND to BUYING and records buying data", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  const updated = updateAcquisitionState(database, acquisition.id, "BUYING", {
    agreedPurchasePriceKrw: 40000,
    boughtAt: "2026-09-13T00:00:00Z",
  });
  assert.equal(updated.status, "BUYING");
  assert.equal(updated.agreedPurchasePriceKrw, 40000);
  assert.equal(updated.boughtAt, "2026-09-13T00:00:00Z");
}));

test("transitions FOUND to IGNORED", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  const updated = updateAcquisitionState(database, acquisition.id, "IGNORED");
  assert.equal(updated.status, "IGNORED");
}));

test("transitions BUYING to RECEIVED and records receivedAt", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  updateAcquisitionState(database, acquisition.id, "BUYING");
  const updated = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-14T00:00:00Z",
  });
  assert.equal(updated.status, "RECEIVED");
  assert.equal(updated.receivedAt, "2026-09-14T00:00:00Z");
}));

test("transitions BUYING to CANCELLED", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  updateAcquisitionState(database, acquisition.id, "BUYING");
  const updated = updateAcquisitionState(database, acquisition.id, "CANCELLED");
  assert.equal(updated.status, "CANCELLED");
}));

test("rejects FOUND to RECEIVED", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  assert.throws(
    () => updateAcquisitionState(database, acquisition.id, "RECEIVED"),
    new Error("Invalid acquisition transition: FOUND -> RECEIVED"),
  );
}));

test("rejects transitions out of terminal states", async (t) => {
  for (const terminalState of ["IGNORED", "RECEIVED", "CANCELLED"]) {
    await t.test(terminalState, () => withDatabase((database) => {
      const { acquisition } = createFixture(database);
      if (terminalState === "IGNORED") {
        updateAcquisitionState(database, acquisition.id, "IGNORED");
      } else {
        updateAcquisitionState(database, acquisition.id, "BUYING");
        updateAcquisitionState(database, acquisition.id, terminalState);
      }
      assert.throws(
        () => updateAcquisitionState(database, acquisition.id, "BUYING"),
        new Error(`Invalid acquisition transition: ${terminalState} -> BUYING`),
      );
    }));
  }
});

test("rejects an invalid listing foreign key", () => withDatabase((database) => {
  assert.throws(
    () => createAcquisition(database, { listingId: 999999 }),
    /FOREIGN KEY constraint failed/,
  );
}));

test("leaves the database unchanged after a failed transition", () => withDatabase((database) => {
  const { acquisition } = createFixture(database);
  assert.throws(
    () => updateAcquisitionState(database, acquisition.id, "RECEIVED"),
  );
  assert.deepEqual(findAcquisitionById(database, acquisition.id), acquisition);
}));

test("returns null when an acquisition does not exist", () => withDatabase((database) => {
  assert.equal(findAcquisitionById(database, 999), null);
  assert.equal(findAcquisitionByListingId(database, 999), null);
}));
