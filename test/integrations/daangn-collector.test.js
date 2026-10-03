import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  collectDaangnListingCandidates,
  DaangnSuppressedResponseError,
  persistDaangnListingCandidates,
} from "../../src/integrations/daangn/daangn-collector.js";

const fixture = readFileSync(
  new URL("../fixtures/daangn-live-remix-search.html", import.meta.url),
  "utf8",
);
const suppressedFixture = readFileSync(
  new URL("../fixtures/daangn-suppressed-search.html", import.meta.url),
  "utf8",
);

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "daangn-collector-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return await callback(database);
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

test("persists null-location candidates and skips only missing required fields", async () => withDatabase(async (database) => {
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

  assert.equal(persisted.saved.length, 3);
  assert.equal(persisted.skipped.length, 1);
  assert.deepEqual(persisted.skipped[0].missing, ["priceKrw"]);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM listings").get().count,
    3,
  );
  assert.equal(
    database.prepare(
      "SELECT seller_location_text AS sellerLocationText FROM listings WHERE external_listing_id = ?",
    ).get("noloc004").sellerLocationText,
    null,
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
    ).get("live001").lastSeenAt,
    "2026-09-29T11:00:00.000Z",
  );
}));


test("does not mistake a live HTTP 200 suppression response for zero listings", async () => {
  const client = {
    async search() {
      return {
        html: suppressedFixture,
        sourceUrl: "https://www.daangn.com/kr/search/buy-sell/?q=test",
      };
    },
  };

  await assert.rejects(
    collectDaangnListingCandidates({
      client,
      keywords: ["통기타"],
    }),
    (error) => error instanceof DaangnSuppressedResponseError,
  );
});
