import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  collectDaangnListingCandidates,
  persistDaangnListingCandidates,
} from "../../src/integrations/daangn/daangn-collector.js";

const fixture = readFileSync(
  new URL("../fixtures/daangn-search.html", import.meta.url),
  "utf8",
);

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "daangn-collector-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function fakeClient() {
  const searches = [];
  return {
    searches,
    async resolveRegion(region) {
      return {
        id: "1234",
        name: region,
        fullName: `충청북도 충주시 ${region}`,
        slug: `${region}-1234`,
        sourceUrl: "https://www.daangn.com/kr/api/v1/regions/keyword",
      };
    },
    async search({ keyword, regionSlug }) {
      searches.push({ keyword, regionSlug });
      return {
        html: fixture,
        sourceUrl: `https://www.daangn.com/kr/buy-sell/?search=${encodeURIComponent(keyword)}`,
      };
    },
  };
}

test("collects configured keywords sequentially and deduplicates external ids", async () => {
  const client = fakeClient();
  const result = await collectDaangnListingCandidates({
    client,
    keywords: ["기타", "통기타", "어쿠스틱 기타"],
    region: "연수동",
    now: () => new Date("2026-09-29T10:00:00Z"),
  });

  assert.equal(client.searches.length, 3);
  assert.ok(client.searches.every(({ regionSlug }) => regionSlug === "연수동-1234"));
  assert.equal(result.candidates.length, 4);
  assert.deepEqual(
    result.candidates[0].sourceMetadata.matchedKeywords,
    ["기타", "통기타", "어쿠스틱 기타"],
  );
});

test("persists only candidates compatible with existing ListingRepository", async () => withDatabase(async (database) => {
  const result = await collectDaangnListingCandidates({
    client: fakeClient(),
    keywords: ["통기타"],
    now: () => new Date("2026-09-29T10:00:00Z"),
  });
  const persisted = persistDaangnListingCandidates(
    database,
    result.candidates,
    { lastSeenAt: result.discoveredAt },
  );

  assert.equal(persisted.saved.length, 2);
  assert.equal(persisted.skipped.length, 2);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM listings").get().count,
    2,
  );
  assert.equal(persisted.saved[0].marketplace, "DAANGN");
}));

test("repeated collection upserts the same external listing instead of duplicating rows", async () => withDatabase(async (database) => {
  const result = await collectDaangnListingCandidates({
    client: fakeClient(),
    keywords: ["통기타"],
    now: () => new Date("2026-09-29T10:00:00Z"),
  });
  persistDaangnListingCandidates(database, result.candidates, {
    lastSeenAt: result.discoveredAt,
  });
  persistDaangnListingCandidates(database, result.candidates, {
    lastSeenAt: "2026-09-29T11:00:00.000Z",
  });
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM listings").get().count,
    2,
  );
  assert.equal(
    database.prepare(
      "SELECT last_seen_at AS lastSeenAt FROM listings WHERE external_listing_id = ?",
    ).get("g110abc123").lastSeenAt,
    "2026-09-29T11:00:00.000Z",
  );
}));
