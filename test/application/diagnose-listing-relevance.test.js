import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseListingRelevance } from "../../src/application/listings/diagnose-listing-relevance.js";

const NOW = new Date("2026-10-17T10:00:00Z");
const listing = (title, lastSeenAt = "2026-10-16T00:00:00Z") => ({
  title,
  description: "",
  lastSeenAt,
});

test("summarizes relevance counts and reasons", () => {
  const result = diagnoseListingRelevance({
    listings: [
      listing("야마하 F310 통기타"),
      listing("기타 굿즈"),
      listing("F310"),
    ],
    now: () => NOW,
  });
  assert.equal(result.counts.RELEVANT, 1);
  assert.equal(result.counts.IRRELEVANT, 1);
  assert.equal(result.counts.UNCERTAIN, 1);
  assert.equal(result.samples.length, 3);
  assert.ok(result.reasonCounts.ACCESSORY_ONLY_MERCH >= 1);
});

test("respects lookback and output limit", () => {
  const result = diagnoseListingRelevance({
    listings: [
      listing("야마하 F310 통기타"),
      listing("기타 굿즈", "2026-08-01T00:00:00Z"),
      listing("F310"),
    ],
    lookbackDays: 30,
    limit: 1,
    now: () => NOW,
  });
  assert.equal(result.samples.length, 1);
  assert.equal(
    result.counts.RELEVANT + result.counts.IRRELEVANT + result.counts.UNCERTAIN,
    2,
  );
});
