import { IDENTITY_CONFIDENCE, normalizeGuitarIdentity } from "../../domain/listing/guitar-identity.js";
import {
  calculateUsedToNewRatio,
  REFERENCE_PRICE_CONFIDENCE,
  USED_NEW_DECISION,
} from "../../domain/listing/reference-new-price.js";
import {
  classifyListingRelevance,
  LISTING_RELEVANCE,
} from "../../domain/listing/listing-relevance.js";

export const OPPORTUNITY_DECISION = Object.freeze({
  TRACK: "TRACK",
  IGNORE: "IGNORE",
  UNRESOLVED_IDENTITY: "UNRESOLVED_IDENTITY",
  UNRESOLVED_REFERENCE: "UNRESOLVED_REFERENCE",
});

function assertPositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
}

function assertThreshold(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("thresholdPct must be a non-negative finite number");
  }
}

function cutoffIso(now, lookbackDays) {
  const nowDate = now();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.getTime())) {
    throw new TypeError("now() must return a valid Date");
  }
  return new Date(nowDate.getTime() - lookbackDays * 86400000).toISOString();
}

function listingKey(listing) {
  if (typeof listing?.externalListingId === "string" && listing.externalListingId !== "") {
    return listing.externalListingId;
  }
  return `${listing?.url ?? ""}\u0000${listing?.title ?? ""}`;
}

function dedupeListings(listings) {
  const seen = new Set();
  const result = [];
  for (const listing of listings) {
    const key = listingKey(listing);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(listing);
  }
  return result;
}

function baseResult(listing, relevance, identity = null) {
  return {
    externalListingId: listing.externalListingId,
    title: listing.title,
    url: listing.url,
    askingPriceKrw: listing.askingPriceKrw,
    relevance: relevance.relevance,
    guitarType: relevance.guitarType,
    brand: identity?.brand ?? null,
    model: identity?.model ?? null,
    variant: identity?.variant ?? null,
    identityConfidence: identity?.confidence ?? "LOW",
    referenceNewPriceKrw: null,
    referenceConfidence: "LOW",
    ratioPct: null,
    decision: null,
    reasons: [...relevance.reasons, ...(identity?.reasons ?? [])],
    lastSeenAt: listing.lastSeenAt,
  };
}

export async function evaluateBunjangOpportunities({
  listings,
  resolver,
  lookbackDays = 30,
  thresholdPct = 12,
  now = () => new Date(),
}) {
  if (!Array.isArray(listings)) {
    throw new TypeError("listings must be an array");
  }
  if (!resolver || typeof resolver.resolve !== "function") {
    throw new TypeError("resolver.resolve must be a function");
  }
  assertPositiveInteger(lookbackDays, "lookbackDays");
  assertThreshold(thresholdPct);

  const cutoff = cutoffIso(now, lookbackDays);
  const uniqueListings = dedupeListings(listings);
  const results = [];
  const referenceGroups = new Map();

  const summary = {
    totalListings: uniqueListings.length,
    stale: 0,
    irrelevant: 0,
    identityUnresolved: 0,
    referenceUnresolved: 0,
    track: 0,
    ignore: 0,
  };

  for (const listing of uniqueListings) {
    if (typeof listing?.lastSeenAt !== "string" || listing.lastSeenAt < cutoff) {
      summary.stale += 1;
      continue;
    }

    const relevance = classifyListingRelevance({
      title: listing.title,
      description: listing.description,
    });

    if (relevance.relevance === LISTING_RELEVANCE.IRRELEVANT) {
      summary.irrelevant += 1;
      continue;
    }

    const identity = normalizeGuitarIdentity({
      title: listing.title,
      description: listing.description,
      guitarType: relevance.guitarType,
    });
    const result = baseResult(listing, relevance, identity);

    if (
      !identity.brand
      || !identity.model
      || identity.confidence === IDENTITY_CONFIDENCE.LOW
    ) {
      result.decision = OPPORTUNITY_DECISION.UNRESOLVED_IDENTITY;
      result.reasons.push("IDENTITY_NOT_ACTIONABLE");
      summary.identityUnresolved += 1;
      results.push(result);
      continue;
    }

    const key = `${identity.brand}\u0000${identity.model}`;
    const group = referenceGroups.get(key) ?? {
      brand: identity.brand,
      model: identity.model,
      items: [],
    };
    group.items.push(result);
    referenceGroups.set(key, group);
  }

  for (const group of referenceGroups.values()) {
    const reference = await resolver.resolve({
      brand: group.brand,
      model: group.model,
    });

    const usableReference = Number.isFinite(reference?.referenceNewPriceKrw)
      && reference.referenceNewPriceKrw > 0
      && (
        reference.confidence === REFERENCE_PRICE_CONFIDENCE.HIGH
        || reference.confidence === REFERENCE_PRICE_CONFIDENCE.MEDIUM
      );

    for (const result of group.items) {
      result.referenceNewPriceKrw = usableReference
        ? reference.referenceNewPriceKrw
        : null;
      result.referenceConfidence = reference?.confidence ?? "LOW";

      if (!usableReference) {
        result.decision = OPPORTUNITY_DECISION.UNRESOLVED_REFERENCE;
        result.reasons.push("REFERENCE_NOT_ACTIONABLE");
        summary.referenceUnresolved += 1;
        results.push(result);
        continue;
      }

      const ratio = calculateUsedToNewRatio({
        askingPriceKrw: result.askingPriceKrw,
        referenceNewPriceKrw: reference.referenceNewPriceKrw,
        referenceConfidence: reference.confidence,
        thresholdPct,
      });

      result.ratioPct = ratio.percentage;
      result.decision = ratio.decision === USED_NEW_DECISION.TRACK
        ? OPPORTUNITY_DECISION.TRACK
        : OPPORTUNITY_DECISION.IGNORE;
      result.reasons.push(
        result.decision === OPPORTUNITY_DECISION.TRACK
          ? "USED_NEW_RATIO_AT_OR_BELOW_THRESHOLD"
          : "USED_NEW_RATIO_ABOVE_THRESHOLD",
      );

      summary[
        result.decision === OPPORTUNITY_DECISION.TRACK ? "track" : "ignore"
      ] += 1;
      results.push(result);
    }
  }

  const decisionRank = new Map([
    [OPPORTUNITY_DECISION.TRACK, 0],
    [OPPORTUNITY_DECISION.IGNORE, 1],
    [OPPORTUNITY_DECISION.UNRESOLVED_REFERENCE, 2],
    [OPPORTUNITY_DECISION.UNRESOLVED_IDENTITY, 3],
  ]);

  results.sort((a, b) => {
    const rankDiff = decisionRank.get(a.decision) - decisionRank.get(b.decision);
    if (rankDiff !== 0) return rankDiff;
    if (
      a.decision === OPPORTUNITY_DECISION.TRACK
      || a.decision === OPPORTUNITY_DECISION.IGNORE
    ) {
      const ratioDiff = (a.ratioPct ?? Infinity) - (b.ratioPct ?? Infinity);
      if (ratioDiff !== 0) return ratioDiff;
    }
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  return {
    lookbackDays,
    thresholdPct,
    cutoff,
    summary,
    results,
    track: results.filter(({ decision }) => decision === OPPORTUNITY_DECISION.TRACK),
    ignore: results.filter(({ decision }) => decision === OPPORTUNITY_DECISION.IGNORE),
    unresolvedReference: results.filter(
      ({ decision }) => decision === OPPORTUNITY_DECISION.UNRESOLVED_REFERENCE,
    ),
    unresolvedIdentity: results.filter(
      ({ decision }) => decision === OPPORTUNITY_DECISION.UNRESOLVED_IDENTITY,
    ),
  };
}
