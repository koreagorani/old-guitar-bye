import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  listListingsByMarketplace,
  saveOrUpdateListing,
} from "../../src/repositories/listing-repository.js";

test("lists only the requested marketplace ordered by last seen", () => {
  const directory = mkdtempSync(join(tmpdir(), "listing-coverage-repository-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    const base = {
      url: "https://example.com/1",
      title: "YAMAHA F310 통기타",
      description: "",
      askingPriceKrw: 50000,
      sellerLocationText: null,
      discoveredAt: "2026-09-01T00:00:00Z",
    };
    saveOrUpdateListing(database, {
      ...base,
      marketplace: "BUNJANG",
      externalListingId: "old",
      lastSeenAt: "2026-09-20T00:00:00Z",
    });
    saveOrUpdateListing(database, {
      ...base,
      marketplace: "BUNJANG",
      externalListingId: "new",
      lastSeenAt: "2026-10-01T00:00:00Z",
    });
    saveOrUpdateListing(database, {
      ...base,
      marketplace: "DAANGN",
      externalListingId: "other",
      lastSeenAt: "2026-10-02T00:00:00Z",
    });

    const rows = listListingsByMarketplace(database, "BUNJANG");
    assert.deepEqual(rows.map(({ externalListingId }) => externalListingId), [
      "new",
      "old",
    ]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
