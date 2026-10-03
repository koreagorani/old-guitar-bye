import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyListingRelevance,
  GUITAR_TYPE_HINT,
  LISTING_RELEVANCE,
} from "../../src/domain/listing/listing-relevance.js";

const cases = [
  ["고퍼우드 G110 통기타", "RELEVANT", "ACOUSTIC"],
  ["야마하 F310 기타 + 케이스", "RELEVANT", "UNKNOWN"],
  ["야마하 F310 기타 + 소프트케이스", "RELEVANT", "UNKNOWN"],
  ["콜트 어스100 어쿠스틱 기타", "RELEVANT", "ACOUSTIC"],
  ["클래식 기타 판매합니다", "RELEVANT", "CLASSICAL"],
  ["통기타 소프트케이스", "IRRELEVANT", "ACOUSTIC"],
  ["야마하 기타 소프트케이스", "IRRELEVANT", "UNKNOWN"],
  ["기타 스트랩", "IRRELEVANT", "UNKNOWN"],
  ["기타줄 새상품", "IRRELEVANT", "UNKNOWN"],
  ["기타 스탠드", "IRRELEVANT", "UNKNOWN"],
  ["기타 앰프", "IRRELEVANT", "UNKNOWN"],
  ["봇치더록 베이스 기타 백", "IRRELEVANT", "BASS"],
  ["F310", "UNCERTAIN", "UNKNOWN"],
  ["야마하 F310", "UNCERTAIN", "UNKNOWN"],
  ["정리합니다", "UNCERTAIN", "UNKNOWN"],
];

for (const [title, relevance, guitarType] of cases) {
  test(`${title} -> ${relevance} / ${guitarType}`, () => {
    assert.deepEqual(
      {
        relevance: classifyListingRelevance({ title }).relevance,
        guitarType: classifyListingRelevance({ title }).guitarType,
      },
      { relevance, guitarType },
    );
  });
}

test("handles English and case-insensitive acoustic guitar text", () => {
  const result = classifyListingRelevance({
    title: "YAMAHA Acoustic Guitar",
  });
  assert.equal(result.relevance, LISTING_RELEVANCE.RELEVANT);
  assert.equal(result.guitarType, GUITAR_TYPE_HINT.ACOUSTIC);
  assert.ok(result.reasons.includes("ACOUSTIC_KEYWORD"));
});

test("recognizes English gig bag as accessory-only", () => {
  const result = classifyListingRelevance({
    title: "Guitar Gig Bag",
  });
  assert.equal(result.relevance, LISTING_RELEVANCE.IRRELEVANT);
  assert.ok(result.reasons.includes("ACCESSORY_ONLY_BAG"));
});

test("handles spacing variants", () => {
  assert.equal(
    classifyListingRelevance({ title: "어쿠스틱기타 판매" }).relevance,
    LISTING_RELEVANCE.RELEVANT,
  );
  assert.equal(
    classifyListingRelevance({ title: "통 기타 하드 케이스" }).relevance,
    LISTING_RELEVANCE.IRRELEVANT,
  );
});

test("does not reject a body listing because an included accessory appears in description", () => {
  const result = classifyListingRelevance({
    title: "야마하 F310 기타",
    description: "소프트케이스와 스트랩 포함합니다.",
  });
  assert.equal(result.relevance, LISTING_RELEVANCE.RELEVANT);
});

test("keeps contradictory accessory title and body description for later review", () => {
  const result = classifyListingRelevance({
    title: "야마하 기타 케이스",
    description: "기타 본체 판매이며 케이스도 같이 드립니다.",
  });
  assert.equal(result.relevance, LISTING_RELEVANCE.UNCERTAIN);
  assert.ok(result.reasons.includes("DESCRIPTION_BODY_CONTEXT"));
});

test("detects electric and bass guitar hints without excluding them", () => {
  const electric = classifyListingRelevance({ title: "Fender electric guitar" });
  const bass = classifyListingRelevance({ title: "Ibanez 베이스 기타 판매" });
  assert.equal(electric.relevance, LISTING_RELEVANCE.RELEVANT);
  assert.equal(electric.guitarType, GUITAR_TYPE_HINT.ELECTRIC);
  assert.equal(bass.relevance, LISTING_RELEVANCE.RELEVANT);
  assert.equal(bass.guitarType, GUITAR_TYPE_HINT.BASS);
});

test("pickup-equipped acoustic guitar is not mistaken for a standalone pickup", () => {
  const result = classifyListingRelevance({ title: "픽업 통기타 판매" });
  assert.equal(result.relevance, LISTING_RELEVANCE.RELEVANT);
  assert.equal(result.guitarType, GUITAR_TYPE_HINT.ACOUSTIC);
});

test("standalone pickup remains irrelevant", () => {
  const result = classifyListingRelevance({ title: "기타 픽업 단품" });
  assert.equal(result.relevance, LISTING_RELEVANCE.IRRELEVANT);
  assert.ok(result.reasons.includes("ACCESSORY_ONLY_PICKUP"));
});

test("rejects invalid title input", () => {
  assert.throws(
    () => classifyListingRelevance({ title: "   " }),
    /title must be a non-empty string/,
  );
  assert.throws(
    () => classifyListingRelevance({ title: 123 }),
    /title must be a string/,
  );
});
