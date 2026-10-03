import { normalizeGuitarIdentity } from "./guitar-identity.js";
import { classifyListingRelevance, LISTING_RELEVANCE } from "./listing-relevance.js";

export const REFERENCE_PRICE_CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

export const USED_NEW_DECISION = Object.freeze({
  TRACK: "TRACK",
  IGNORE: "IGNORE",
  UNRESOLVED: "UNRESOLVED",
});

const BUNDLE_PATTERN = /(?:풀\s*패키지|풀\s*세트|입문(?:용)?\s*(?:풀\s*)?세트|패키지\s*(?:상품|구성|기타)?|starter\s*pack|bundle|package)/i;
const USED_PATTERN = /(?:^|[\s[(])(중고|used|리퍼(?:브)?|refurb(?:ished)?|전시품|반품상품|b[ -]?stock)(?=$|[\s)\]])/i;
const RENTAL_PATTERN = /(?:렌탈|대여|rental)/i;

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateReferencePriceCandidate({
  brand,
  model,
  source,
  productTitle,
  priceKrw,
  url,
  inStock = null,
  observedAt,
}) {
  assertNonEmptyString(brand, "brand");
  assertNonEmptyString(model, "model");
  assertNonEmptyString(source, "source");
  assertNonEmptyString(productTitle, "productTitle");
  assertNonEmptyString(url, "url");
  assertNonEmptyString(observedAt, "observedAt");

  const identity = normalizeGuitarIdentity({
    title: productTitle,
    guitarType: "UNKNOWN",
  });
  const relevance = classifyListingRelevance({ title: productTitle });
  const isBundle = BUNDLE_PATTERN.test(productTitle);
  const isUsed = USED_PATTERN.test(productTitle);
  const isRental = RENTAL_PATTERN.test(productTitle);
  const isAccessory = relevance.relevance === LISTING_RELEVANCE.IRRELEVANT;
  const exactMatch = identity.brand === brand && identity.model === model;
  const validPrice = Number.isSafeInteger(priceKrw) && priceKrw > 0;

  const rejectionReasons = [];
  if (!exactMatch) rejectionReasons.push("IDENTITY_MISMATCH");
  if (!validPrice) rejectionReasons.push("INVALID_PRICE");
  if (isBundle) rejectionReasons.push("BUNDLE");
  if (isUsed) rejectionReasons.push("USED");
  if (isRental) rejectionReasons.push("RENTAL");
  if (isAccessory) rejectionReasons.push("ACCESSORY");
  if (inStock === false) rejectionReasons.push("OUT_OF_STOCK");

  return {
    brand,
    model,
    source,
    productTitle,
    priceKrw: Number.isSafeInteger(priceKrw) ? priceKrw : null,
    url,
    inStock,
    isBundle,
    isUsed,
    isRental,
    isAccessory,
    exactMatch,
    observedAt,
    confidence: rejectionReasons.length === 0
      ? (inStock === true
        ? REFERENCE_PRICE_CONFIDENCE.HIGH
        : REFERENCE_PRICE_CONFIDENCE.MEDIUM)
      : REFERENCE_PRICE_CONFIDENCE.LOW,
    rejectionReasons,
  };
}

export function resolveReferenceNewPrice({
  brand,
  model,
  candidates,
}) {
  assertNonEmptyString(brand, "brand");
  assertNonEmptyString(model, "model");
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array");
  }

  const usable = candidates.filter((candidate) =>
    candidate
    && candidate.brand === brand
    && candidate.model === model
    && candidate.rejectionReasons?.length === 0
    && Number.isSafeInteger(candidate.priceKrw)
    && candidate.priceKrw > 0
    && candidate.inStock !== false
  );

  const grouped = new Map();
  for (const candidate of usable) {
    const entries = grouped.get(candidate.source) ?? [];
    entries.push(candidate);
    grouped.set(candidate.source, entries);
  }

  const sourcePrices = [...grouped.entries()].map(([source, entries]) => ({
    source,
    priceKrw: median(entries.map(({ priceKrw }) => priceKrw)),
    urls: [...new Set(entries.map(({ url }) => url))],
    candidateCount: entries.length,
  }));

  const sourceCount = sourcePrices.length;
  const referenceNewPriceKrw = sourceCount === 0
    ? null
    : median(sourcePrices.map(({ priceKrw }) => priceKrw));
  const confidence = sourceCount >= 2
    ? REFERENCE_PRICE_CONFIDENCE.HIGH
    : sourceCount === 1
      ? REFERENCE_PRICE_CONFIDENCE.MEDIUM
      : REFERENCE_PRICE_CONFIDENCE.LOW;

  return {
    brand,
    model,
    referenceNewPriceKrw,
    sourceCount,
    confidence,
    sources: usable,
    sourcePrices,
    rejectedCandidates: candidates.filter((candidate) => !usable.includes(candidate)),
  };
}

export function calculateUsedToNewRatio({
  askingPriceKrw,
  referenceNewPriceKrw,
  referenceConfidence,
}) {
  assertNonNegativeInteger(askingPriceKrw, "askingPriceKrw");

  const usableReference = Number.isFinite(referenceNewPriceKrw)
    && referenceNewPriceKrw > 0
    && (
      referenceConfidence === REFERENCE_PRICE_CONFIDENCE.HIGH
      || referenceConfidence === REFERENCE_PRICE_CONFIDENCE.MEDIUM
    );

  if (!usableReference) {
    return {
      ratio: null,
      percentage: null,
      decision: USED_NEW_DECISION.UNRESOLVED,
    };
  }

  const ratio = askingPriceKrw / referenceNewPriceKrw;
  const percentage = ratio * 100;

  return {
    ratio,
    percentage,
    decision: percentage <= 12
      ? USED_NEW_DECISION.TRACK
      : USED_NEW_DECISION.IGNORE,
  };
}
