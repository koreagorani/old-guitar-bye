import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseLowConfidenceListings } from "../../src/application/listings/diagnose-low-confidence.js";

const NOW = new Date("2026-10-06T10:00:00Z");
function listing(title, overrides = {}) {
  return { title, description: "", lastSeenAt: "2026-10-05T00:00:00Z", ...overrides };
}

test("groups LOW confidence reasons", () => {
  const result = diagnoseLowConfidenceListings({
    listings: [
      listing("야마하 통기타"),
      listing("F310"),
      listing("정리합니다"),
      listing("기타 스트랩"),
      listing("YAMAHA F310 통기타"),
    ],
    now: () => NOW,
  });
  assert.equal(result.lowConfidenceCount, 3);
  assert.equal(result.reasonCounts.BRAND_ONLY, 1);
  assert.equal(result.reasonCounts.MODEL_ONLY, 1);
  assert.equal(result.reasonCounts.NO_IDENTITY, 1);
});

test("respects lookback and sample limit", () => {
  const result = diagnoseLowConfidenceListings({
    listings: [
      listing("야마하 통기타"),
      listing("F310", { lastSeenAt: "2026-10-04T00:00:00Z" }),
      listing("정리합니다", { lastSeenAt: "2026-08-01T00:00:00Z" }),
    ],
    lookbackDays: 30,
    limit: 1,
    now: () => NOW,
  });
  assert.equal(result.lowConfidenceCount, 2);
  assert.equal(result.samples.length, 1);
});
