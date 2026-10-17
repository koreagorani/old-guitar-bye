import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateBunjangOpportunities,
  OPPORTUNITY_DECISION,
} from "../../src/application/listings/evaluate-bunjang-opportunities.js";

const NOW = new Date("2026-10-17T10:00:00Z");

function listing(overrides = {}) {
  return {
    externalListingId: "1",
    title: "YAMAHA F310 통기타",
    url: "https://example.com/1",
    askingPriceKrw: 20000,
    description: "",
    lastSeenAt: "2026-10-16T00:00:00Z",
    ...overrides,
  };
}

function resolverFor(prices = {}) {
  const calls = [];
  return {
    calls,
    async resolve({ brand, model }) {
      calls.push({ brand, model });
      const entry = prices[`${brand}:${model}`];
      if (!entry) {
        return {
          referenceNewPriceKrw: null,
          confidence: "LOW",
        };
      }
      return {
        referenceNewPriceKrw: entry.price,
        confidence: entry.confidence ?? "MEDIUM",
      };
    },
  };
}

test("excludes IRRELEVANT listings", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [
      listing({ title: "기타 굿즈" }),
      listing({ externalListingId: "2" }),
    ],
    resolver: resolverFor(),
    now: () => NOW,
  });
  assert.equal(result.summary.irrelevant, 1);
  assert.equal(result.results.length, 1);
});

test("keeps UNCERTAIN listings for identity evaluation", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [
      listing({
        title: "YAMAHA F310",
      }),
    ],
    resolver: resolverFor({
      "YAMAHA:F310": { price: 200000 },
    }),
    now: () => NOW,
  });
  assert.equal(result.results[0].relevance, "UNCERTAIN");
  assert.equal(result.results[0].decision, "TRACK");
});

test("HIGH and MEDIUM identities are actionable while LOW is unresolved", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [
      listing({ externalListingId: "high", title: "YAMAHA F310 통기타" }),
      listing({
        externalListingId: "medium",
        title: "야마하 통기타",
        description: "모델: F310",
      }),
      listing({
        externalListingId: "low",
        title: "야마하 통기타",
      }),
    ],
    resolver: resolverFor({
      "YAMAHA:F310": { price: 200000 },
    }),
    now: () => NOW,
  });
  assert.equal(
    result.results.find(({ externalListingId }) => externalListingId === "high").decision,
    OPPORTUNITY_DECISION.TRACK,
  );
  assert.equal(
    result.results.find(({ externalListingId }) => externalListingId === "medium").decision,
    OPPORTUNITY_DECISION.TRACK,
  );
  assert.equal(
    result.results.find(({ externalListingId }) => externalListingId === "low").decision,
    OPPORTUNITY_DECISION.UNRESOLVED_IDENTITY,
  );
});

test("missing or LOW reference is UNRESOLVED_REFERENCE", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [
      listing({ externalListingId: "missing" }),
      listing({ externalListingId: "lowref", title: "CORT AD810 통기타" }),
    ],
    resolver: resolverFor({
      "CORT:AD810": { price: 184000, confidence: "LOW" },
    }),
    now: () => NOW,
  });
  assert.equal(result.summary.referenceUnresolved, 2);
  assert.ok(result.results.every(
    ({ decision }) => decision === OPPORTUNITY_DECISION.UNRESOLVED_REFERENCE,
  ));
});

for (const [askingPriceKrw, expected] of [
  [11990, "TRACK"],
  [12000, "TRACK"],
  [12010, "IGNORE"],
]) {
  test(`threshold boundary ${askingPriceKrw} -> ${expected}`, async () => {
    const result = await evaluateBunjangOpportunities({
      listings: [listing({ askingPriceKrw })],
      resolver: resolverFor({
        "YAMAHA:F310": { price: 100000 },
      }),
      now: () => NOW,
    });
    assert.equal(result.results[0].decision, expected);
  });
}

test("zero-price listing is TRACK", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [listing({ askingPriceKrw: 0 })],
    resolver: resolverFor({
      "YAMAHA:F310": { price: 200000 },
    }),
    now: () => NOW,
  });
  assert.equal(result.results[0].ratioPct, 0);
  assert.equal(result.results[0].decision, "TRACK");
});

test("TRACK results sort by ratio ascending", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [
      listing({ externalListingId: "b", askingPriceKrw: 10000 }),
      listing({ externalListingId: "a", askingPriceKrw: 5000 }),
    ],
    resolver: resolverFor({
      "YAMAHA:F310": { price: 100000 },
    }),
    now: () => NOW,
  });
  assert.deepEqual(
    result.track.map(({ externalListingId }) => externalListingId),
    ["a", "b"],
  );
});

test("deduplicates repeated external listing ids", async () => {
  const resolver = resolverFor({
    "YAMAHA:F310": { price: 200000 },
  });
  const result = await evaluateBunjangOpportunities({
    listings: [
      listing({ externalListingId: "same" }),
      listing({ externalListingId: "same", askingPriceKrw: 10000 }),
    ],
    resolver,
    now: () => NOW,
  });
  assert.equal(result.summary.totalListings, 1);
  assert.equal(result.results.length, 1);
  assert.equal(resolver.calls.length, 1);
});

test("resolves each unique brand/model only once", async () => {
  const resolver = resolverFor({
    "YAMAHA:F310": { price: 200000 },
  });
  await evaluateBunjangOpportunities({
    listings: [
      listing({ externalListingId: "1" }),
      listing({ externalListingId: "2", title: "YAMAHA F-310 통기타" }),
    ],
    resolver,
    now: () => NOW,
  });
  assert.equal(resolver.calls.length, 1);
});

test("lookbackDays excludes stale rows", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [
      listing(),
      listing({
        externalListingId: "stale",
        lastSeenAt: "2026-08-01T00:00:00Z",
      }),
    ],
    resolver: resolverFor(),
    lookbackDays: 30,
    now: () => NOW,
  });
  assert.equal(result.summary.stale, 1);
  assert.equal(result.results.length, 1);
});

test("threshold override changes decision", async () => {
  const result = await evaluateBunjangOpportunities({
    listings: [listing({ askingPriceKrw: 13000 })],
    resolver: resolverFor({
      "YAMAHA:F310": { price: 100000 },
    }),
    thresholdPct: 13,
    now: () => NOW,
  });
  assert.equal(result.results[0].decision, "TRACK");
  assert.equal(result.thresholdPct, 13);
});
