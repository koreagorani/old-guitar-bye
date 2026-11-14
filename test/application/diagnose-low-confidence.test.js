import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBunjangOpportunities } from "../../src/application/listings/evaluate-bunjang-opportunities.js";
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

test("reports all stored rows and recent failures, with per-brand prices and literal title hints", () => {
  const examples = [
    listing("펜더 Stratocaster 통기타", { askingPriceKrw: 30000, url: "https://example.test/1" }),
    listing("FENDER STRATOCASTER 통기타", { askingPriceKrw: 90000 }),
    listing("펜더 Stratocaster 통기타 도착", { askingPriceKrw: 0 }),
    listing("펜더 D-7 통기타", { askingPriceKrw: 120000, lastSeenAt: "2026-08-01T00:00:00Z" }),
    listing("FENDER CD60 통기타"),
    listing("DAVID X300", { askingPriceKrw: 1000 }),
    listing("기타 스트랩"),
  ];
  const result = diagnoseLowConfidenceListings({ listings: examples, now: () => NOW, limit: 1 });

  assert.equal(result.totalListings, 6);
  assert.equal(result.allTime.totalListings, 7);
  assert.equal(result.allTime.lowConfidenceCount, 5);
  assert.equal(result.identityActionableCount, 1);
  assert.equal(result.irrelevant, 1);
  assert.equal(result.lowConfidenceCount, 4);
  assert.deepEqual(result.failureRelevanceCounts, { RELEVANT: 3, UNCERTAIN: 1 });
  assert.equal(result.samples[0].url, "https://example.test/1");
  assert.equal(result.samples[0].askingPriceKrw, 30000);

  const [fender, unknown] = result.byBrand;
  assert.equal(fender.brand, "FENDER");
  assert.equal(fender.failureRatePct, 75);
  assert.deepEqual(fender.titleModelHints, [{ hint: "STRATOCASTER", count: 3 }]);
  assert.deepEqual(fender.askingPriceKrw, {
    positiveCount: 2, zeroOrInvalidCount: 1, min: 30000,
    p25: 30000, median: 30000, p75: 90000, max: 90000,
  });
  assert.equal(unknown.brand, null);
  assert.equal(result.reviewPriorities[0].reason, "BRAND_ONLY");
  assert.equal(result.reviewPriorities[0].relevant, 3);
  assert.match(result.reviewPriorities[0].reviewRisk, /variants/);
});

test("recent failures match the evaluator at the cutoff and group conflicts", async () => {
  const listings = [
    listing("펜더 야마하 통기타"),
    listing("야마하 F310 통기타", { description: "브랜드: 펜더" }),
    listing("야마하 F310 FS800 통기타"),
    listing("야마하 F310 통기타", { description: "모델명: FS800" }),
    listing("통기타", { description: "브랜드: 야마하, 모델명: F310" }),
    listing("야마하 통기타", { lastSeenAt: "2026-09-06T10:00:00.000Z" }),
    listing("야마하 통기타", { lastSeenAt: "2026-09-06T09:59:59.999Z" }),
    listing("기타 스트랩"),
  ].map((row, index) => ({ ...row, externalListingId: String(index), askingPriceKrw: 1000 }));
  const options = { listings, now: () => NOW };
  const diagnosis = diagnoseLowConfidenceListings(options);
  const evaluation = await evaluateBunjangOpportunities({
    ...options,
    resolver: { resolve: async () => null },
  });

  assert.equal(diagnosis.lowConfidenceCount, evaluation.summary.identityUnresolved);
  assert.equal(diagnosis.lowConfidenceCount, 5);
  assert.equal(diagnosis.allTime.lowConfidenceCount, 6);
  assert.deepEqual(diagnosis.reasonCounts, {
    AMBIGUOUS_BRAND: 1, BRAND_CONFLICT: 1, BRAND_ONLY: 1,
    MODEL_CONFLICT: 1, MULTIPLE_MODEL_CANDIDATES: 1,
  });
});

test("empty reports expose empty groups and null price quantiles", () => {
  const report = diagnoseLowConfidenceListings({ listings: [], now: () => NOW });
  assert.deepEqual(report.allTime.byBrand, []);
  assert.equal(report.askingPriceKrw.median, null);
  assert.equal(report.lowConfidenceCount, 0);
});
