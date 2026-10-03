import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateUsedToNewRatio,
  evaluateReferencePriceCandidate,
  REFERENCE_PRICE_CONFIDENCE,
  resolveReferenceNewPrice,
  USED_NEW_DECISION,
} from "../../src/domain/listing/reference-new-price.js";

const observedAt = "2026-10-03T08:00:00.000Z";

function candidate(overrides = {}) {
  return evaluateReferencePriceCandidate({
    brand: "YAMAHA",
    model: "F310",
    source: "SOURCE_A",
    productTitle: "YAMAHA F310 acoustic guitar",
    priceKrw: 195000,
    url: "https://example.com/f310",
    inStock: true,
    observedAt,
    ...overrides,
  });
}

test("accepts exact brand/model match", () => {
  const result = candidate();
  assert.equal(result.exactMatch, true);
  assert.deepEqual(result.rejectionReasons, []);
  assert.equal(result.confidence, REFERENCE_PRICE_CONFIDENCE.HIGH);
});

test("does not confuse F310 with FX310A", () => {
  const result = candidate({
    productTitle: "YAMAHA FX310A acoustic guitar",
  });
  assert.equal(result.exactMatch, false);
  assert.ok(result.rejectionReasons.includes("IDENTITY_MISMATCH"));
});

test("rejects bundle, accessory, used, and rental products", () => {
  const bundle = candidate({ productTitle: "YAMAHA F310 입문 풀세트" });
  const accessory = candidate({ productTitle: "YAMAHA F310 기타 케이스" });
  const used = candidate({ productTitle: "중고 YAMAHA F310 기타" });
  const rental = candidate({ productTitle: "YAMAHA F310 기타 렌탈" });
  assert.ok(bundle.rejectionReasons.includes("BUNDLE"));
  assert.ok(accessory.rejectionReasons.includes("ACCESSORY"));
  assert.ok(used.rejectionReasons.includes("USED"));
  assert.ok(rental.rejectionReasons.includes("RENTAL"));
});

test("one usable source resolves with MEDIUM confidence", () => {
  const resolved = resolveReferenceNewPrice({
    brand: "YAMAHA",
    model: "F310",
    candidates: [candidate()],
  });
  assert.equal(resolved.referenceNewPriceKrw, 195000);
  assert.equal(resolved.sourceCount, 1);
  assert.equal(resolved.confidence, REFERENCE_PRICE_CONFIDENCE.MEDIUM);
});

test("two or more sources use source-level median with HIGH confidence", () => {
  const resolved = resolveReferenceNewPrice({
    brand: "YAMAHA",
    model: "F310",
    candidates: [
      candidate({ source: "A", priceKrw: 190000, url: "https://a/1" }),
      candidate({ source: "A", priceKrw: 200000, url: "https://a/2" }),
      candidate({ source: "B", priceKrw: 205000, url: "https://b/1" }),
    ],
  });
  assert.equal(resolved.sourceCount, 2);
  assert.equal(resolved.referenceNewPriceKrw, 200000);
  assert.equal(resolved.confidence, REFERENCE_PRICE_CONFIDENCE.HIGH);
});

test("zero usable source stays unresolved", () => {
  const resolved = resolveReferenceNewPrice({
    brand: "YAMAHA",
    model: "F310",
    candidates: [
      candidate({ productTitle: "YAMAHA F310 풀패키지" }),
    ],
  });
  assert.equal(resolved.referenceNewPriceKrw, null);
  assert.equal(resolved.sourceCount, 0);
  assert.equal(resolved.confidence, REFERENCE_PRICE_CONFIDENCE.LOW);
});

for (const [askingPriceKrw, expected] of [
  [12000, USED_NEW_DECISION.TRACK],
  [11990, USED_NEW_DECISION.TRACK],
  [12010, USED_NEW_DECISION.IGNORE],
]) {
  test(`${askingPriceKrw / 1000}% boundary decision is ${expected}`, () => {
    const result = calculateUsedToNewRatio({
      askingPriceKrw,
      referenceNewPriceKrw: 100000,
      referenceConfidence: REFERENCE_PRICE_CONFIDENCE.HIGH,
    });
    assert.equal(result.decision, expected);
  });
}

test("free used listing produces zero ratio and TRACK", () => {
  const result = calculateUsedToNewRatio({
    askingPriceKrw: 0,
    referenceNewPriceKrw: 200000,
    referenceConfidence: REFERENCE_PRICE_CONFIDENCE.MEDIUM,
  });
  assert.equal(result.ratio, 0);
  assert.equal(result.percentage, 0);
  assert.equal(result.decision, USED_NEW_DECISION.TRACK);
});

test("invalid or LOW-confidence reference is UNRESOLVED", () => {
  for (const referenceNewPriceKrw of [null, 0, -1]) {
    const result = calculateUsedToNewRatio({
      askingPriceKrw: 10000,
      referenceNewPriceKrw,
      referenceConfidence: REFERENCE_PRICE_CONFIDENCE.HIGH,
    });
    assert.equal(result.decision, USED_NEW_DECISION.UNRESOLVED);
  }

  const low = calculateUsedToNewRatio({
    askingPriceKrw: 10000,
    referenceNewPriceKrw: 200000,
    referenceConfidence: REFERENCE_PRICE_CONFIDENCE.LOW,
  });
  assert.equal(low.decision, USED_NEW_DECISION.UNRESOLVED);
});
