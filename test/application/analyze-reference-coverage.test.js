import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeReferenceCoverage,
} from "../../src/application/listings/analyze-reference-coverage.js";

const NOW = new Date("2026-10-03T12:00:00Z");

function listing(overrides = {}) {
  return {
    id: 1,
    marketplace: "BUNJANG",
    externalListingId: "1",
    url: "https://example.com/1",
    title: "YAMAHA F310 통기타",
    description: "",
    askingPriceKrw: 50000,
    sellerLocationText: "서울",
    discoveredAt: "2026-09-20T00:00:00Z",
    lastSeenAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function resolverFor(map = {}) {
  const calls = [];
  return {
    calls,
    async resolve({ brand, model }) {
      calls.push({ brand, model });
      const price = map[`${brand}:${model}`] ?? null;
      return {
        referenceNewPriceKrw: price,
        confidence: price ? "MEDIUM" : "LOW",
      };
    },
  };
}

test("excludes IRRELEVANT listings", async () => {
  const resolver = resolverFor();
  const result = await analyzeReferenceCoverage({
    listings: [
      listing({ title: "기타 스트랩", externalListingId: "strap" }),
      listing(),
    ],
    resolver,
    now: () => NOW,
  });
  assert.equal(result.summary.irrelevantListings, 1);
  assert.equal(result.summary.totalIdentifiedListings, 1);
});

test("excludes LOW confidence identities separately", async () => {
  const resolver = resolverFor();
  const result = await analyzeReferenceCoverage({
    listings: [
      listing({
        title: "야마하 통기타",
        description: "",
      }),
      listing(),
    ],
    resolver,
    now: () => NOW,
  });
  assert.equal(result.summary.lowConfidenceListings, 1);
  assert.equal(result.summary.identityIncompleteListings, 0);
  assert.equal(result.summary.totalIdentifiedListings, 1);
});

test("aggregates identical brand and model and resolves once", async () => {
  const resolver = resolverFor({ "YAMAHA:F310": 190000 });
  const result = await analyzeReferenceCoverage({
    listings: [
      listing({ externalListingId: "1" }),
      listing({ externalListingId: "2", title: "YAMAHA F-310 acoustic guitar" }),
    ],
    resolver,
    now: () => NOW,
  });
  assert.equal(result.aggregates.length, 1);
  assert.equal(result.aggregates[0].listingCount, 2);
  assert.equal(result.aggregates[0].resolvedCount, 2);
  assert.equal(resolver.calls.length, 1);
});

test("classifies unresolved models and sorts by unresolved count", async () => {
  const resolver = resolverFor({ "YAMAHA:F310": 190000 });
  const result = await analyzeReferenceCoverage({
    listings: [
      listing({ externalListingId: "1", title: "CRAFTER GCL80 통기타" }),
      listing({ externalListingId: "2", title: "CRAFTER GCL-80 통기타" }),
      listing({ externalListingId: "3", title: "YAMAHA F310 통기타" }),
      listing({ externalListingId: "4", title: "CORT EARTH100 통기타" }),
    ],
    resolver,
    now: () => NOW,
  });
  assert.deepEqual(
    result.aggregates.map(({ brand, model, unresolvedCount }) => ({
      brand,
      model,
      unresolvedCount,
    })),
    [
      { brand: "CRAFTER", model: "GCL80", unresolvedCount: 2 },
      { brand: "CORT", model: "EARTH100", unresolvedCount: 1 },
      { brand: "YAMAHA", model: "F310", unresolvedCount: 0 },
    ],
  );
});

test("honors lookbackDays and excludes stale listings", async () => {
  const resolver = resolverFor();
  const result = await analyzeReferenceCoverage({
    listings: [
      listing({ externalListingId: "fresh", lastSeenAt: "2026-09-20T00:00:00Z" }),
      listing({ externalListingId: "stale", lastSeenAt: "2026-08-01T00:00:00Z" }),
    ],
    resolver,
    lookbackDays: 30,
    now: () => NOW,
  });
  assert.equal(result.summary.staleListings, 1);
  assert.equal(result.summary.totalIdentifiedListings, 1);
});

test("limits and deduplicates example titles", async () => {
  const resolver = resolverFor();
  const result = await analyzeReferenceCoverage({
    listings: [
      listing({ externalListingId: "1", title: "CRAFTER GCL80 통기타" }),
      listing({ externalListingId: "2", title: "CRAFTER GCL80 통기타" }),
      listing({ externalListingId: "3", title: "CRAFTER GCL-80 탑솔리드 통기타" }),
      listing({ externalListingId: "4", title: "크래프터 GCL80 어쿠스틱 기타" }),
    ],
    resolver,
    exampleTitleLimit: 2,
    now: () => NOW,
  });
  assert.equal(result.aggregates[0].exampleTitles.length, 2);
  assert.equal(new Set(result.aggregates[0].exampleTitles).size, 2);
});

test("computes summary and brand coverage", async () => {
  const resolver = resolverFor({ "YAMAHA:F310": 190000 });
  const result = await analyzeReferenceCoverage({
    listings: [
      listing({ externalListingId: "1", title: "YAMAHA F310 통기타" }),
      listing({ externalListingId: "2", title: "CRAFTER GCL80 통기타" }),
      listing({ externalListingId: "3", title: "CRAFTER GCL-80 통기타" }),
    ],
    resolver,
    now: () => NOW,
  });

  assert.deepEqual(result.summary, {
    totalInputListings: 3,
    staleListings: 0,
    irrelevantListings: 0,
    identityIncompleteListings: 0,
    lowConfidenceListings: 0,
    totalIdentifiedListings: 3,
    resolvedListings: 1,
    unresolvedListings: 2,
    resolvedRate: 1 / 3,
    unresolvedRate: 2 / 3,
    uniqueBrandModelCount: 2,
    unresolvedUniqueModelCount: 1,
  });
  assert.equal(result.brands[0].brand, "CRAFTER");
  assert.equal(result.brands[0].unresolvedCount, 2);
});
