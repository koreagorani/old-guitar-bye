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

function countByConfidence() {
  return { HIGH: 0, MEDIUM: 0, LOW: 0 };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return hash >>> 0;
}

function identityExample(identity) {
  return { brand: identity.brand, model: identity.model ? redactListingText(identity.model) : null,
    confidence: identity.confidence, reasons: identity.reasons };
}

function stratifiedReview(buckets, limit) {
  const seen = new Set();
  const selected = [];
  for (const group of Object.values(buckets)) {
    group.sort((a, b) => stableHash(a.row.externalListingId) - stableHash(b.row.externalListingId)
      || a.row.externalListingId.localeCompare(b.row.externalListingId));
  }
  while (selected.length < limit) {
    let added = false;
    for (const [pattern, group] of Object.entries(buckets)) {
      while (group.length && seen.has(group[0].row.externalListingId)) group.shift();
      if (!group.length) continue;
      const { row, identity } = group.shift();
      seen.add(row.externalListingId);
      selected.push({ ...example(row), pattern, identity: identityExample(identity),
        manualReview: "NOT_REVIEWED" });
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected;
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
  baselineNormalize = normalizeGuitarIdentity,
  reviewLimit = 24,
}) {
  if (!Array.isArray(listings)) throw new TypeError("listings must be an array");
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 1
    || !Number.isSafeInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 30
    || !Number.isSafeInteger(reviewLimit) || reviewLimit < 1 || reviewLimit > 100) {
    throw new TypeError("lookbackDays, exampleLimit, reviewLimit must be positive integers (exampleLimit <= 30, reviewLimit <= 100)");
  }
  if ((baselineClassify !== null && typeof baselineClassify !== "function")
    || typeof baselineNormalize !== "function") {
    throw new TypeError("baselineClassify and baselineNormalize must be functions");
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
  const reviewBuckets = Object.fromEntries(Object.keys(DEFINITIONS).map((key) => [key, []]));
  const currentCounts = countByRelevance();
  const baselineCounts = countByRelevance();
  const changes = { newlyRelevant: 0, newlyIrrelevant: 0, newlyReferenceEligible: 0,
    lostReferenceEligible: 0,
    newlyRelevantAlreadyReferenceEligible: 0, examples: [] };
  const identityChanges = { changed: 0, modelAdded: 0, modelRemoved: 0,
    confidenceTransitions: {}, safetyDowngrades: [], newlyIdentified: [], otherChanges: [] };
  const confidenceCounts = { baseline: countByConfidence(), current: countByConfidence() };
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
    confidenceCounts.current[currentIdentity.confidence] += 1;
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
        reviewBuckets[key].push({ row, identity: currentIdentity });
        for (const group of [patterns, ...(noDecisive ? [noDecisivePatterns] : [])]) {
          group[key].count += 1;
          if (group[key].examples.length < exampleLimit) group[key].examples.push(example(row));
        }
      }
    }

    if (baselineClassify) {
      const baseline = baselineClassify(row);
      baselineCounts[baseline.relevance] += 1;
      const baselineIdentity = baselineNormalize({
        title: row.title, description: row.description, guitarType: baseline.guitarType,
      });
      confidenceCounts.baseline[baselineIdentity.confidence] += 1;
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
      if (baselineEligible && !currentEligible) changes.lostReferenceEligible += 1;
      if (baseline.relevance !== LISTING_RELEVANCE.RELEVANT
        && current.relevance === LISTING_RELEVANCE.RELEVANT && baselineEligible) {
        changes.newlyRelevantAlreadyReferenceEligible += 1;
      }
      if (baselineIdentity.brand !== currentIdentity.brand
        || baselineIdentity.model !== currentIdentity.model
        || baselineIdentity.confidence !== currentIdentity.confidence) {
        identityChanges.changed += 1;
        if (!baselineIdentity.model && currentIdentity.model) identityChanges.modelAdded += 1;
        if (baselineIdentity.model && !currentIdentity.model) identityChanges.modelRemoved += 1;
        const transition = `${baselineIdentity.confidence}->${currentIdentity.confidence}`;
        identityChanges.confidenceTransitions[transition] =
          (identityChanges.confidenceTransitions[transition] ?? 0) + 1;
        const changedExample = { ...example(row), before: identityExample(baselineIdentity),
          after: identityExample(currentIdentity), beforeRelevance: baseline.relevance,
          afterRelevance: current.relevance, beforeReferenceEligible: baselineEligible,
          afterReferenceEligible: currentEligible, manualReview: "NOT_REVIEWED" };
        const group = baselineIdentity.confidence !== IDENTITY_CONFIDENCE.LOW
          && currentIdentity.confidence === IDENTITY_CONFIDENCE.LOW
          ? identityChanges.safetyDowngrades
          : !baselineIdentity.model && currentIdentity.model
            ? identityChanges.newlyIdentified : identityChanges.otherChanges;
        if (group.length < exampleLimit) group.push(changedExample);
      }
    }
  }

  return {
    cutoff, lookbackDays, total: recent.length, counts: currentCounts,
    uncertain: currentCounts.UNCERTAIN, noDecisiveCount,
    patterns, noDecisivePatterns, irrelevantOtherEtcCount,
    patternInterpretation: "패턴은 중복 집계되는 제목 기반 휴리스틱이며, 본문/사진을 수동 검증한 결과가 아님",
    reviewSampleMethod: "제목 패턴별 ID 고정 해시 순 라운드로빈, 중복 제외. 자동 단서이며 수동 검증 아님",
    reviewSamples: stratifiedReview(reviewBuckets, reviewLimit),
    identityCounts: baselineClassify ? identityCounts : {
      currentBrandAndModel: identityCounts.currentBrandAndModel,
      currentReferenceEligible: identityCounts.currentReferenceEligible,
    },
    comparison: baselineClassify ? {
      baselineCounts, currentCounts, changes, confidenceCounts, identityChanges,
      confidenceInterpretation: "식별 확신도 건수는 최근 매물 전체(관련성 무관)를 분모로 함",
      referenceInterpretation: "신품가 조회 대상은 관련성이 IRRELEVANT가 아니고 브랜드·모델 및 식별 확신도가 충분한 매물. 실제 신품가 조회 성공이나 TRACK을 의미하지 않음",
    } : null,
  };
}
