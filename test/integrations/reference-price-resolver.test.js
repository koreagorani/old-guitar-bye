import assert from "node:assert/strict";
import test from "node:test";

import { createReferenceNewPriceResolver } from "../../src/integrations/new-price/reference-price-resolver.js";

function source(id, products) {
  let calls = 0;
  return {
    id,
    get calls() { return calls; },
    async search() {
      calls += 1;
      return { products, sourceUrl: "https://example.com/search" };
    },
  };
}

test("resolver combines exact matches from independent sources", async () => {
  const observedAt = "2026-10-03T08:00:00Z";
  const a = source("A", [{
    source: "A",
    productTitle: "YAMAHA F310",
    priceKrw: 190000,
    url: "https://a/f310",
    inStock: true,
    observedAt,
  }]);
  const b = source("B", [{
    source: "B",
    productTitle: "YAMAHA F310",
    priceKrw: 205000,
    url: "https://b/f310",
    inStock: true,
    observedAt,
  }]);

  const resolver = createReferenceNewPriceResolver({
    sources: [a, b],
    now: () => new Date(observedAt),
  });
  const result = await resolver.resolve({ brand: "YAMAHA", model: "F310" });
  assert.equal(result.referenceNewPriceKrw, 197500);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.confidence, "HIGH");
});

test("resolver caches a source search by brand", async () => {
  const observedAt = "2026-10-03T08:00:00Z";
  const a = source("A", []);
  const resolver = createReferenceNewPriceResolver({
    sources: [a],
    now: () => new Date(observedAt),
  });
  await resolver.resolve({ brand: "CRAFTER", model: "DX25" });
  await resolver.resolve({ brand: "CRAFTER", model: "GCL80" });
  assert.equal(a.calls, 1);
});


test("model-specific sources cache independently by brand and model", async () => {
  const observedAt = "2026-10-03T08:00:00Z";
  let calls = 0;
  const modelSource = {
    id: "MODEL_SOURCE",
    cacheByModel: true,
    async search({ brand, model }) {
      calls += 1;
      return {
        products: [],
        sourceUrl: `https://example.com/search?q=${brand}+${model}`,
      };
    },
  };
  const resolver = createReferenceNewPriceResolver({
    sources: [modelSource],
    now: () => new Date(observedAt),
  });

  await resolver.resolve({ brand: "CRAFTER", model: "DX25" });
  await resolver.resolve({ brand: "CRAFTER", model: "DX25" });
  await resolver.resolve({ brand: "CRAFTER", model: "GCL80" });

  assert.equal(calls, 2);
});
