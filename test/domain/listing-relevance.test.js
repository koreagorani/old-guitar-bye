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


test("rejects Korean 기타 used as other/etc context", () => {
  const titles = [
    "ssd 최고가 매입합니다 삼성 하이닉스 WD 기타 등등",
    "[무료배송]오토바이 헬멧 블루투스 팜 - 기타 외",
    "(새상품 미사용)오토바이 헬멧용 블루투스 팜 - 기타 외 세나 비모토-마",
    "기타 여러 상품 정리",
    "기타 품목 일괄 판매",
  ];
  for (const title of titles) {
    const result = classifyListingRelevance({ title });
    assert.equal(result.relevance, LISTING_RELEVANCE.IRRELEVANT, title);
  }
});

test("rejects obvious non-instrument product contexts", () => {
  const titles = [
    "천재 기타리스트 랜디 로즈 와 오지 오스본 LP",
    "기타 피규어",
    "기타 굿즈",
    "일렉기타 포토카드 굿즈 양도",
  ];
  for (const title of titles) {
    assert.equal(
      classifyListingRelevance({ title }).relevance,
      LISTING_RELEVANCE.IRRELEVANT,
      title,
    );
  }
});

test("keeps strong guitar-body evidence relevant", () => {
  const titles = [
    "픽업 통기타",
    "덱스터 어쿠스틱기타",
    "헥스 통기타",
    "스윙 베이스기타",
    "스윙 일렉기타(화이트)",
    "EQ장착 어쿠스틱 기타 (가방 포함)",
    "야마하 F310 기타 + 케이스",
    "콜트 AD810 통기타",
  ];
  for (const title of titles) {
    assert.equal(
      classifyListingRelevance({ title }).relevance,
      LISTING_RELEVANCE.RELEVANT,
      title,
    );
  }
});

test("rejects buyer-intent posts from sale discovery", () => {
  for (const title of [
    "Martin D28 구합니다",
    "Taylor 214ce 찾습니다",
    "야마하 F310 삽니다",
  ]) {
    const result = classifyListingRelevance({ title });
    assert.equal(result.relevance, LISTING_RELEVANCE.IRRELEVANT, title);
    assert.ok(result.reasons.some((reason) => reason.startsWith("BUYER_INTENT_")));
  }
});

test("known brand plus model plus generic guitar remains relevant", () => {
  const result = classifyListingRelevance({ title: "야마하 F310 기타" });
  assert.equal(result.relevance, LISTING_RELEVANCE.RELEVANT);
  assert.ok(result.reasons.includes("BRAND_MODEL_GUITAR_CONTEXT"));
});
