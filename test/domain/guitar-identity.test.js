import assert from "node:assert/strict";
import test from "node:test";

import {
  IDENTITY_CONFIDENCE,
  normalizeGuitarIdentity,
} from "../../src/domain/listing/guitar-identity.js";
import {
  classifyListingRelevance,
  LISTING_RELEVANCE,
} from "../../src/domain/listing/listing-relevance.js";

const exactCases = [
  ["야마하 F310 통기타", "YAMAHA", "F310", "HIGH"],
  ["YAMAHA F-310 acoustic guitar", "YAMAHA", "F310", "HIGH"],
  ["야마하f310", "YAMAHA", "F310", "HIGH"],
  ["콜트 Earth100 어쿠스틱 기타", "CORT", "EARTH100", "HIGH"],
  ["CORT EARTH 100", "CORT", "EARTH100", "HIGH"],
  ["크래프터 DX-25", "CRAFTER", "DX25", "HIGH"],
  ["GOPHERWOOD G110", "GOPHERWOOD", "G110", "HIGH"],
  ["Crafter OMEGA CSP Plus 통기타", "CRAFTER", "OMEGA CSP PLUS", "HIGH"],
  ["Martin D-28 acoustic guitar", "MARTIN", "D28", "HIGH"],
  ["Taylor 214ce", "TAYLOR", "214CE", "HIGH"],
];

for (const [title, brand, model, confidence] of exactCases) {
  test(title + " normalizes deterministically", () => {
    const result = normalizeGuitarIdentity({
      title,
      guitarType: "ACOUSTIC",
    });
    assert.equal(result.brand, brand);
    assert.equal(result.model, model);
    assert.equal(result.confidence, confidence);
  });
}

test("model-only title remains usable with low confidence", () => {
  const result = normalizeGuitarIdentity({ title: "F310" });
  assert.equal(result.brand, null);
  assert.equal(result.model, "F310");
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.LOW);
  assert.ok(result.reasons.includes("BRAND_NOT_FOUND"));
  assert.ok(result.reasons.includes("MODEL_FROM_TITLE"));
});

test("brand-only title does not invent a model", () => {
  const result = normalizeGuitarIdentity({ title: "야마하 통기타" });
  assert.equal(result.brand, "YAMAHA");
  assert.equal(result.model, null);
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.LOW);
  assert.ok(result.reasons.includes("MODEL_NOT_FOUND"));
});

test("description may supplement an explicitly labelled model", () => {
  const result = normalizeGuitarIdentity({
    title: "야마하 통기타 판매",
    description: "상태 좋습니다. 모델은 F-310 입니다.",
    guitarType: "ACOUSTIC",
  });
  assert.equal(result.brand, "YAMAHA");
  assert.equal(result.model, "F310");
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.MEDIUM);
  assert.ok(result.reasons.includes("MODEL_FROM_DESCRIPTION"));
});

test("description without explicit model context does not override title", () => {
  const result = normalizeGuitarIdentity({
    title: "야마하 F310 통기타",
    description: "2024년에 구매했고 다른 FG800도 보유 중입니다.",
    guitarType: "ACOUSTIC",
  });
  assert.equal(result.brand, "YAMAHA");
  assert.equal(result.model, "F310");
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.HIGH);
});

test("conflicting title and explicitly labelled description models are not guessed", () => {
  const result = normalizeGuitarIdentity({
    title: "야마하 F310 통기타",
    description: "모델: FG800",
    guitarType: "ACOUSTIC",
  });
  assert.equal(result.brand, "YAMAHA");
  assert.equal(result.model, null);
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.LOW);
  assert.ok(result.reasons.includes("TITLE_DESCRIPTION_MODEL_CONFLICT"));
});

test("conflicting title and description brands return null brand", () => {
  const result = normalizeGuitarIdentity({
    title: "야마하 F310",
    description: "콜트 기타라고도 적혀 있습니다.",
  });
  assert.equal(result.brand, null);
  assert.equal(result.model, "F310");
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.LOW);
  assert.ok(result.reasons.includes("TITLE_DESCRIPTION_BRAND_CONFLICT"));
});

test("unknown brand is not invented", () => {
  const result = normalizeGuitarIdentity({ title: "루나 G100 기타" });
  assert.equal(result.brand, null);
  assert.equal(result.model, "G100");
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.LOW);
});

test("supports requested Korean brand aliases", () => {
  const expectations = [
    ["야마하 F310", "YAMAHA"],
    ["콜트 Earth100", "CORT"],
    ["크래프터 DX25", "CRAFTER"],
    ["고퍼우드 G110", "GOPHERWOOD"],
    ["마틴 D28", "MARTIN"],
    ["테일러 214CE", "TAYLOR"],
    ["펜더 CD60", "FENDER"],
    ["깁슨 J45", "GIBSON"],
    ["다카미네 GD20", "TAKAMINE"],
    ["타카미네 GD20", "TAKAMINE"],
    ["아이바네즈 AW54", "IBANEZ"],
    ["에피폰 DR100", "EPIPHONE"],
    ["헥스 F100", "HEX"],
    ["덱스터 D100", "DEXTER"],
    ["삼익 D100", "SAMICK"],
    ["세고비아 SJ1000", "SEGOVIA"],
  ];

  for (const [title, brand] of expectations) {
    assert.equal(
      normalizeGuitarIdentity({ title }).brand,
      brand,
      title,
    );
  }
});

test("UNCERTAIN relevance proceeds to deterministic identity normalization", () => {
  const listing = { title: "야마하 F310" };
  const relevance = classifyListingRelevance(listing);
  assert.equal(relevance.relevance, LISTING_RELEVANCE.UNCERTAIN);

  const identity = normalizeGuitarIdentity({
    title: listing.title,
    guitarType: relevance.guitarType,
  });
  assert.equal(identity.brand, "YAMAHA");
  assert.equal(identity.model, "F310");
});

test("IRRELEVANT accessory is gated before identity normalization", () => {
  const listing = { title: "야마하 기타 소프트케이스" };
  const relevance = classifyListingRelevance(listing);
  assert.equal(relevance.relevance, LISTING_RELEVANCE.IRRELEVANT);

  const identity = relevance.relevance === LISTING_RELEVANCE.IRRELEVANT
    ? null
    : normalizeGuitarIdentity({
      title: listing.title,
      guitarType: relevance.guitarType,
    });
  assert.equal(identity, null);
});

test("obvious hyphen variation is canonicalized", () => {
  const result = normalizeGuitarIdentity({ title: "YAMAHA F-310" });
  assert.equal(result.model, "F310");
  assert.ok(result.reasons.includes("MODEL_CANONICALIZED"));
});

test("guitar type is retained as a debug reason but does not invent identity", () => {
  const result = normalizeGuitarIdentity({
    title: "판매합니다",
    guitarType: "CLASSICAL",
  });
  assert.equal(result.brand, null);
  assert.equal(result.model, null);
  assert.equal(result.confidence, IDENTITY_CONFIDENCE.LOW);
  assert.ok(result.reasons.includes("GUITAR_TYPE_CLASSICAL"));
});

test("validates input without guessing", () => {
  assert.throws(
    () => normalizeGuitarIdentity({ title: "" }),
    /title must be a non-empty string/,
  );
  assert.throws(
    () => normalizeGuitarIdentity({
      title: "F310",
      guitarType: "UKULELE",
    }),
    /Unknown guitarType/,
  );
});


test("Cort L100-O keeps meaningful model suffix and separates finish", () => {
  const result = normalizeGuitarIdentity({ title: "Cort L100-O NS" });
  assert.equal(result.brand, "CORT");
  assert.equal(result.model, "L100-O");
  assert.equal(result.variant, "NS");
  assert.equal(result.confidence, "HIGH");
});

test("Dexter DOM-16-MOP separates model from variant", () => {
  const result = normalizeGuitarIdentity({ title: "Dexter DOM-16-MOP" });
  assert.equal(result.brand, "DEXTER");
  assert.equal(result.model, "DOM16");
  assert.equal(result.variant, "MOP");
  assert.equal(result.confidence, "HIGH");
});

test("Dexter DOM 16m-OP normalizes the same variant", () => {
  const result = normalizeGuitarIdentity({ title: "덱스터 Dom 16m-OP 마호가니" });
  assert.equal(result.model, "DOM16");
  assert.equal(result.variant, "MOP");
  assert.equal(result.confidence, "HIGH");
});

test("Gopherwood S Classic V ignores arbitrary BLACK500 code", () => {
  const result = normalizeGuitarIdentity({
    title: "GopherWood - S Classic V Jet Black (BLACK500) 기타",
  });
  assert.equal(result.brand, "GOPHERWOOD");
  assert.equal(result.model, "S CLASSIC V");
  assert.equal(result.variant, "JET BLACK");
  assert.equal(result.confidence, "HIGH");
});

test("brand-aware text models improve recall", () => {
  assert.equal(
    normalizeGuitarIdentity({ title: "크래프터 SURE PLUS 어쿠스틱 기타" }).model,
    "SURE PLUS",
  );
  assert.equal(
    normalizeGuitarIdentity({ title: "[새상품] 콜트 어스 100 입문용 기타" }).model,
    "EARTH100",
  );
  assert.equal(
    normalizeGuitarIdentity({ title: "야마하 SLG-200s 사일런트 어쿠스틱기타" }).model,
    "SLG200S",
  );
});

test("nested generic numeric match no longer creates a false conflict", () => {
  const result = normalizeGuitarIdentity({ title: "YAMAHA SLG-200s" });
  assert.equal(result.model, "SLG200S");
  assert.equal(result.confidence, "HIGH");
});

test("existing model regressions remain stable", () => {
  const cases = [
    ["CORT AD810", "AD810"],
    ["GOPHERWOOD G110", "G110"],
    ["GOPHERWOOD K330RCE", "K330RCE"],
    ["EPIPHONE EJ-200", "EJ200"],
    ["EPIPHONE PR-150 NA", "PR150"],
  ];
  for (const [title, model] of cases) {
    assert.equal(normalizeGuitarIdentity({ title }).model, model, title);
  }
});
