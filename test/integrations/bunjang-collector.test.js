import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  collectBunjangListingCandidates,
  persistBunjangListingCandidates,
} from "../../src/integrations/bunjang/bunjang-collector.js";

const fixture = JSON.parse(readFileSync(
  new URL("../fixtures/bunjang-search.json", import.meta.url),
  "utf8",
));
const detail = JSON.parse(readFileSync(
  new URL("../fixtures/bunjang-detail.json", import.meta.url),
  "utf8",
));

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "bunjang-collector-"));
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
  const details = [];
  return {
    searches,
    details,
    async search({ keyword, limit }) {
      searches.push({ keyword, limit });
      return {
        data: fixture,
        sourceUrl: `https://api.bunjang.co.kr/api/1/find_v2.json?q=${keyword}`,
      };
    },
    async detail(id) {
      details.push(id);
      return {
        data: id === "300001"
          ? detail
          : { data:{ product:{ pid:Number(id) } } },
      };
    },
  };
}

test("deduplicates identical external ids across configured keywords", async () => {
  const client = fakeClient();
  const result = await collectBunjangListingCandidates({
    client,
    keywords:["기타","통기타","어쿠스틱 기타"],
    resultsPerKeyword:10,
    now:() => new Date("2026-10-01T10:00:00Z"),
  });
  assert.equal(client.searches.length, 3);
  assert.equal(result.candidates.length, 4);
  assert.deepEqual(
    result.candidates.find(({ externalListingId }) => externalListingId === "300001")
      .sourceMetadata.matchedKeywords,
    ["기타","통기타","어쿠스틱 기타"],
  );
});

test("optionally enriches candidates using the detail endpoint", async () => {
  const client = fakeClient();
  const result = await collectBunjangListingCandidates({
    client,
    keywords:["통기타"],
    resultsPerKeyword:1,
    enrichDetails:true,
  });
  assert.deepEqual(client.details, ["300001"]);
  assert.equal(result.candidates[0].sellerName, "기타상점");
});

test("persists compatible listings and skips incomplete candidates", async () =>
  withDatabase(async (database) => {
    const result = await collectBunjangListingCandidates({
      client:fakeClient(),
      keywords:["통기타"],
      resultsPerKeyword:10,
      now:() => new Date("2026-10-01T10:00:00Z"),
    });
    const persisted = persistBunjangListingCandidates(
      database,
      result.candidates,
      { lastSeenAt:result.discoveredAt },
    );
    assert.equal(persisted.saved.length, 2);
    assert.equal(persisted.skipped.length, 2);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM listings").get().count,
      2,
    );
    assert.ok(persisted.saved.every(({ marketplace }) => marketplace === "BUNJANG"));
  }));

test("repeated persistence updates instead of duplicating the listing row", async () =>
  withDatabase(async (database) => {
    const result = await collectBunjangListingCandidates({
      client:fakeClient(),
      keywords:["통기타"],
      resultsPerKeyword:1,
      now:() => new Date("2026-10-01T10:00:00Z"),
    });
    persistBunjangListingCandidates(database, result.candidates, {
      lastSeenAt:"2026-10-01T10:00:00Z",
    });
    persistBunjangListingCandidates(database, result.candidates, {
      lastSeenAt:"2026-10-01T11:00:00Z",
    });
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM listings").get().count,
      1,
    );
    assert.equal(
      database.prepare(
        "SELECT last_seen_at AS lastSeenAt FROM listings WHERE marketplace=? AND external_listing_id=?",
      ).get("BUNJANG","300001").lastSeenAt,
      "2026-10-01T11:00:00Z",
    );
  }));
