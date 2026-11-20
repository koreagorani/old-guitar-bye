import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseTitlePatterns } from "../../src/application/listings/diagnose-title-patterns.js";
import { classifyListingRelevance } from "../../src/domain/listing/listing-relevance.js";

const now = () => new Date("2026-11-17T00:00:00Z");
const row = (id, title, description = "") => ({
  externalListingId: id, title, description,
  lastSeenAt: "2026-11-16T00:00:00Z",
});

test("counts overlapping UNCERTAIN title patterns without claiming human verification", () => {
  const listings = [
    row("1", "나이키 운동화"),
    row("2", "야마하"),
    row("3", "F310"),
    row("4", "콜트 어스100"),
    row("5", "야마하 F310 통기타 기타 상품 소프트백"),
    row("6", "기타 상품 정리"),
    { ...row("7", "정리합니다"), lastSeenAt: "2026-09-01T00:00:00Z" },
  ];
  const report = diagnoseTitlePatterns({ listings, now });
  assert.equal(report.total, 6);
  assert.equal(report.counts.UNCERTAIN, 5);
  assert.equal(report.noDecisiveCount, 4);
  assert.equal(report.patterns.NO_KOREAN_GUITAR_WORD.count, 4);
  assert.equal(report.patterns.OTHER_ETC_MEANING.count, 1);
  assert.equal(report.patterns.BRAND_WITHOUT_MODEL.count, 1);
  assert.equal(report.patterns.MODEL_LIKE_WITHOUT_BRAND.count, 1);
  assert.equal(report.patterns.MODEL_CANDIDATE_WITHOUT_TYPE.count, 2);
  assert.equal(report.patterns.SUSPECTED_UNRELATED_SEARCH_RESULT.count, 1);
  assert.equal(report.irrelevantOtherEtcCount, 1);
  assert.equal(report.noDecisivePatterns.SUSPECTED_UNRELATED_SEARCH_RESULT.count, 1);
  assert.equal(report.comparison, null);
  assert.match(report.patternInterpretation, /수동 검증한 결과가 아님/);
  assert.equal(report.patterns.SUSPECTED_UNRELATED_SEARCH_RESULT.examples[0].url,
    "https://m.bunjang.co.kr/products/1");
  assert.deepEqual(diagnoseTitlePatterns({ listings: [...listings].reverse(), now }).patterns,
    report.patterns);
  assert.ok(report.reviewSamples.every((item) => item.manualReview === "NOT_REVIEWED"));
  assert.equal(new Set(report.reviewSamples.map((item) => item.url)).size,
    report.reviewSamples.length);
  assert.deepEqual(diagnoseTitlePatterns({ listings: [...listings].reverse(), now }).reviewSamples,
    report.reviewSamples);
});

test("reports a wrong HIGH amp code as a safety downgrade and lost reference eligibility", () => {
  const title = "cort 콜트 베이스기타 사용 10회미만, 기타 입문용 앰프 15w 8인치 스피커 기타 거치대 세트 판매";
  const report = diagnoseTitlePatterns({
    listings: [row("10", title)], now,
    baselineClassify: classifyListingRelevance,
    baselineNormalize: () => ({ brand: "CORT", model: "15W", confidence: "HIGH", reasons: ["MODEL_FROM_TITLE"] }),
  });
  assert.deepEqual(report.comparison.confidenceCounts,
    { baseline: { HIGH: 1, MEDIUM: 0, LOW: 0 },
      current: { HIGH: 0, MEDIUM: 0, LOW: 1 } });
  assert.equal(report.comparison.identityChanges.modelRemoved, 1);
  assert.equal(report.comparison.identityChanges.confidenceTransitions["HIGH->LOW"], 1);
  assert.equal(report.comparison.identityChanges.safetyDowngrades.length, 1);
  assert.ok(report.comparison.identityChanges.safetyDowngrades[0].after.reasons
    .includes("MODEL_CANDIDATE_MEASUREMENT"));
  assert.equal(report.comparison.changes.lostReferenceEligible, 1);
});

test("compares the same rows and separates relevance from reference eligibility", () => {
  const listings = [
    row("1", "콜트 g280 일렉기타&바시너 기타가방",
      "콜트 G280 일렉기타 본체 판매, 상태 설명과 가방 구성"),
    row("2", "헥스 세미 클래식기타 픽업 Y500N",
      "헥스 Y500N 클래식 기타 본품 및 구성품 판매, 새상품"),
    row("3", "콜트 어스100 기타", "Cort Earth100 기타 본체와 구성품 판매"),
    row("4", "기타 거치대"),
  ];
  const report = diagnoseTitlePatterns({
    listings, now,
    baselineClassify: (listing) => {
      if (listing.title === "기타 거치대" || listing.title === "콜트 어스100 기타") {
        return { relevance: "UNCERTAIN", guitarType: "UNKNOWN", reasons: [] };
      }
      return { ...classifyListingRelevance({ title: listing.title }), reasons: [] };
    },
  });
  assert.deepEqual(report.comparison.baselineCounts,
    { RELEVANT: 0, UNCERTAIN: 4, IRRELEVANT: 0 });
  assert.deepEqual(report.comparison.currentCounts,
    { RELEVANT: 3, UNCERTAIN: 0, IRRELEVANT: 1 });
  assert.equal(report.comparison.changes.newlyRelevant, 3);
  assert.equal(report.comparison.changes.newlyIrrelevant, 1);
  assert.equal(report.comparison.changes.newlyReferenceEligible, 0);
  assert.equal(report.comparison.changes.newlyRelevantAlreadyReferenceEligible, 3);
  assert.equal(report.identityCounts.currentBrandAndModel, 3);
  assert.equal(report.identityCounts.baselineBrandAndModel, 3);
  assert.equal(report.identityCounts.currentReferenceEligible, 3);
  assert.equal(report.identityCounts.baselineReferenceEligible, 3);
});

test("title examples redact personal contact patterns", () => {
  const report = diagnoseTitlePatterns({
    listings: [row("1", "나이키 운동화 문의 010-1234-5678")], now,
  });
  assert.equal(JSON.stringify(report).includes("010-1234-5678"), false);
});
