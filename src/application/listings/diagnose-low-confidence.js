import { IDENTITY_CONFIDENCE, normalizeGuitarIdentity } from "../../domain/listing/guitar-identity.js";
import {
  classifyListingRelevance,
  LISTING_RELEVANCE,
} from "../../domain/listing/listing-relevance.js";

function assertPositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
}

function cutoffIso(now, lookbackDays) {
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("now() must return a valid Date");
  }
  return new Date(date.getTime() - lookbackDays * 86400000).toISOString();
}

export function classifyLowConfidenceReason(identity) {
  if (identity.reasons.includes("MULTIPLE_BRANDS_IN_SOURCE")) return "AMBIGUOUS_BRAND";
  if (identity.reasons.includes("TITLE_DESCRIPTION_BRAND_CONFLICT")) return "BRAND_CONFLICT";
  if (identity.reasons.includes("MULTIPLE_MODELS_IN_SOURCE")) return "MULTIPLE_MODEL_CANDIDATES";
  if (identity.reasons.includes("TITLE_DESCRIPTION_MODEL_CONFLICT")) return "MODEL_CONFLICT";
  if (!identity.brand && identity.model) return "MODEL_ONLY";
  if (identity.brand && !identity.model) return "BRAND_ONLY";
  if (!identity.brand && !identity.model) return "NO_IDENTITY";
  if (identity.reasons.includes("MODEL_FROM_DESCRIPTION")) return "DESCRIPTION_ONLY";
  return "OTHER_LOW";
}

export function diagnoseLowConfidenceListings({
  listings,
  lookbackDays = 30,
  limit = 30,
  now = () => new Date(),
}) {
  if (!Array.isArray(listings)) throw new TypeError("listings must be an array");
  assertPositiveInteger(lookbackDays, "lookbackDays");
  assertPositiveInteger(limit, "limit");

  const cutoff = cutoffIso(now, lookbackDays);
  const low = [];
  const reasonCounts = {};

  for (const listing of listings) {
    if (typeof listing?.lastSeenAt !== "string" || listing.lastSeenAt < cutoff) continue;

    const relevance = classifyListingRelevance({
      title: listing.title,
      description: listing.description,
    });
    if (relevance.relevance === LISTING_RELEVANCE.IRRELEVANT) continue;

    const identity = normalizeGuitarIdentity({
      title: listing.title,
      description: listing.description,
      guitarType: relevance.guitarType,
    });
    if (identity.confidence !== IDENTITY_CONFIDENCE.LOW) continue;

    const lowReason = classifyLowConfidenceReason(identity);
    reasonCounts[lowReason] = (reasonCounts[lowReason] ?? 0) + 1;
    low.push({
      title: listing.title,
      relevance: relevance.relevance,
      guitarType: relevance.guitarType,
      brand: identity.brand,
      model: identity.model,
      variant: identity.variant ?? null,
      confidence: identity.confidence,
      lowReason,
      reasons: identity.reasons,
      lastSeenAt: listing.lastSeenAt,
    });
  }

  low.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  return {
    lookbackDays,
    cutoff,
    lowConfidenceCount: low.length,
    reasonCounts: Object.fromEntries(
      Object.entries(reasonCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    samples: low.slice(0, limit),
  };
}
