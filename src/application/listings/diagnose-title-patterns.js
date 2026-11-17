import { classifyListingRelevance, LISTING_RELEVANCE } from "../../domain/listing/listing-relevance.js";
import { IDENTITY_CONFIDENCE, normalizeGuitarIdentity } from "../../domain/listing/guitar-identity.js";
import { redactListingText } from "./diagnose-uncertain.js";

const MODEL_CODE = /(?<![A-Z0-9])(?:[A-Z]{1,12}[- _]?\d{2,5}[A-Z]{0,5}|[가-힣]{2,10}\s*\d{2,5}[A-Z]{0,5}|\d{2,4}[A-Z]{1,5})(?![A-Z0-9])/iu;
const OTHER_ETC = /기타\s*(?:등등|등(?:\s|$)|외(?:\s|$)|여러(?:\s|$)|상품(?:\s|$)|품목(?:\s|$))/i;
const INSTRUMENT_CUE = /기타|guitar|베이스|어쿠스틱|일렉|클래식|acoustic|electric|classical|\bbass\b/i;

const DEFINITIONS = Object.freeze({
  NO_KOREAN_GUITAR_WORD: "제목에 한글 '기타'가 없음. 영어 guitar 등은 있을 수 있음",
  OTHER_ETC_MEANING: "제목에 '기타 상품/외/등' 등의 표현이 있음",
  BRAND_WITHOUT_MODEL: "제목에서 브랜드만 인식하고 모델은 인식하지 못함",
  MODEL_LIKE_WITHOUT_BRAND: "브랜드 인식 없이 제목에 모델 코드로 보이는 문자열이 있음. 코드 진위 미검증",
  MODEL_CANDIDATE_WITHOUT_TYPE: "제목에서 모델을 인식했지만 악기 종류는 UNKNOWN",
  SUSPECTED_UNRELATED_SEARCH_RESULT: "제목에 악기 표현, 인식된 브랜드/모델, 모델 코드 단서가 없음. 무관 상품 의심일 뿐 미검증",
});

function example(row) {
  return {
    title: redactListingText(row.title),
    url: /^\d+$/.test(row.externalListingId)
      ? `https://m.bunjang.co.kr/products/${row.externalListingId}` : null,
  };
}

function countByRelevance() {
  return { RELEVANT: 0, UNCERTAIN: 0, IRRELEVANT: 0 };
}

function referenceEligible(relevance, identity) {
  // The current evaluator admits both RELEVANT and UNCERTAIN to identity/reference evaluation.
  return relevance !== LISTING_RELEVANCE.IRRELEVANT && !!identity.brand && !!identity.model
    && identity.confidence !== IDENTITY_CONFIDENCE.LOW;
}

function patternsFor(row, identity, relevance) {
  const title = row.title.normalize("NFKC");
  const modelLike = identity.model !== null || MODEL_CODE.test(redactListingText(title));
  return {
    NO_KOREAN_GUITAR_WORD: !title.includes("기타"),
    OTHER_ETC_MEANING: OTHER_ETC.test(title),
    BRAND_WITHOUT_MODEL: identity.brand !== null && identity.model === null,
    MODEL_LIKE_WITHOUT_BRAND: identity.brand === null && modelLike,
    MODEL_CANDIDATE_WITHOUT_TYPE: identity.model !== null && relevance.guitarType === "UNKNOWN",
    SUSPECTED_UNRELATED_SEARCH_RESULT: !INSTRUMENT_CUE.test(title)
      && !identity.brand && !modelLike,
  };
}

export function diagnoseTitlePatterns({
  listings,
  now = () => new Date(),
  lookbackDays = 30,
  exampleLimit = 3,
  baselineClassify = null,
}) {
  if (!Array.isArray(listings)) throw new TypeError("listings must be an array");
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 1
    || !Number.isSafeInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 30) {
    throw new TypeError("lookbackDays and exampleLimit must be positive integers (exampleLimit <= 30)");
  }
  if (baselineClassify !== null && typeof baselineClassify !== "function") {
    throw new TypeError("baselineClassify must be a function");
  }
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError("now must return a valid Date");
  const cutoff = new Date(date.getTime() - lookbackDays * 86400000).toISOString();
  const recent = listings.filter(({ lastSeenAt }) => typeof lastSeenAt === "string" && lastSeenAt >= cutoff)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)
      || a.externalListingId.localeCompare(b.externalListingId));
  const patterns = Object.fromEntries(Object.entries(DEFINITIONS).map(([key, definition]) =>
    [key, { definition, count: 0, examples: [] }]));
  const noDecisivePatterns = Object.fromEntries(Object.entries(DEFINITIONS).map(([key, definition]) =>
    [key, { definition, count: 0, examples: [] }]));
  const currentCounts = countByRelevance();
  const baselineCounts = countByRelevance();
  const changes = { newlyRelevant: 0, newlyIrrelevant: 0, newlyReferenceEligible: 0,
    newlyRelevantAlreadyReferenceEligible: 0, examples: [] };
  const identityCounts = { currentBrandAndModel: 0, baselineBrandAndModel: 0,
    currentReferenceEligible: 0, baselineReferenceEligible: 0 };
  let noDecisiveCount = 0;
  let irrelevantOtherEtcCount = 0;

  for (const row of recent) {
    const current = classifyListingRelevance(row);
    currentCounts[current.relevance] += 1;
    const titleIdentity = normalizeGuitarIdentity({ title: row.title });
    const currentIdentity = normalizeGuitarIdentity({
      title: row.title, description: row.description, guitarType: current.guitarType,
    });
    if (currentIdentity.brand && currentIdentity.model) identityCounts.currentBrandAndModel += 1;
    const currentEligible = referenceEligible(current.relevance, currentIdentity);
    if (currentEligible) identityCounts.currentReferenceEligible += 1;
    if (current.relevance === LISTING_RELEVANCE.IRRELEVANT
      && current.reasons.includes("KOREAN_OTHER_ETC_CONTEXT")) irrelevantOtherEtcCount += 1;

    if (current.relevance === LISTING_RELEVANCE.UNCERTAIN) {
      const noDecisive = current.reasons.includes("NO_DECISIVE_GUITAR_BODY_SIGNAL");
      if (noDecisive) noDecisiveCount += 1;
      const flags = patternsFor(row, titleIdentity, current);
      for (const [key, present] of Object.entries(flags)) {
        if (!present) continue;
        for (const group of [patterns, ...(noDecisive ? [noDecisivePatterns] : [])]) {
          group[key].count += 1;
          if (group[key].examples.length < exampleLimit) group[key].examples.push(example(row));
        }
      }
    }

    if (baselineClassify) {
      const baseline = baselineClassify(row);
      baselineCounts[baseline.relevance] += 1;
      const baselineIdentity = normalizeGuitarIdentity({
        title: row.title, description: row.description, guitarType: baseline.guitarType,
      });
      if (baselineIdentity.brand && baselineIdentity.model) identityCounts.baselineBrandAndModel += 1;
      const baselineEligible = referenceEligible(baseline.relevance, baselineIdentity);
      if (baselineEligible) identityCounts.baselineReferenceEligible += 1;
      if (baseline.relevance !== current.relevance) {
        if (current.relevance === LISTING_RELEVANCE.RELEVANT) changes.newlyRelevant += 1;
        if (current.relevance === LISTING_RELEVANCE.IRRELEVANT) changes.newlyIrrelevant += 1;
        if (changes.examples.length < exampleLimit) changes.examples.push({
          ...example(row), before: baseline.relevance, after: current.relevance,
          identity: { brand: currentIdentity.brand, model: currentIdentity.model,
            confidence: currentIdentity.confidence },
          alreadyReferenceEligible: baselineEligible,
        });
      }
      if (!baselineEligible && currentEligible) changes.newlyReferenceEligible += 1;
      if (baseline.relevance !== LISTING_RELEVANCE.RELEVANT
        && current.relevance === LISTING_RELEVANCE.RELEVANT && baselineEligible) {
        changes.newlyRelevantAlreadyReferenceEligible += 1;
      }
    }
  }

  return {
    cutoff, lookbackDays, total: recent.length, counts: currentCounts,
    uncertain: currentCounts.UNCERTAIN, noDecisiveCount,
    patterns, noDecisivePatterns, irrelevantOtherEtcCount,
    patternInterpretation: "패턴은 중복 집계되는 제목 기반 휴리스틱이며, 본문/사진을 수동 검증한 결과가 아님",
    identityCounts: baselineClassify ? identityCounts : {
      currentBrandAndModel: identityCounts.currentBrandAndModel,
      currentReferenceEligible: identityCounts.currentReferenceEligible,
    },
    comparison: baselineClassify ? {
      baselineCounts, currentCounts, changes,
      referenceInterpretation: "신품가 조회 대상은 관련성이 IRRELEVANT가 아니고 브랜드·모델 및 식별 확신도가 충분한 매물. 실제 신품가 조회 성공이나 TRACK을 의미하지 않음",
    } : null,
  };
}
