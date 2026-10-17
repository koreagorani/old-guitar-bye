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

export function diagnoseListingRelevance({
  listings,
  lookbackDays = 30,
  limit = 30,
  now = () => new Date(),
}) {
  if (!Array.isArray(listings)) throw new TypeError("listings must be an array");
  assertPositiveInteger(lookbackDays, "lookbackDays");
  assertPositiveInteger(limit, "limit");

  const cutoff = cutoffIso(now, lookbackDays);
  const counts = {
    [LISTING_RELEVANCE.RELEVANT]: 0,
    [LISTING_RELEVANCE.IRRELEVANT]: 0,
    [LISTING_RELEVANCE.UNCERTAIN]: 0,
  };
  const reasonCounts = {};
  const rows = [];

  for (const listing of listings) {
    if (typeof listing?.lastSeenAt !== "string" || listing.lastSeenAt < cutoff) continue;
    const result = classifyListingRelevance({
      title: listing.title,
      description: listing.description,
    });
    counts[result.relevance] += 1;
    for (const reason of result.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    rows.push({
      title: listing.title,
      relevance: result.relevance,
      guitarType: result.guitarType,
      reasons: result.reasons,
      lastSeenAt: listing.lastSeenAt,
    });
  }

  rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  return {
    lookbackDays,
    cutoff,
    counts,
    reasonCounts: Object.fromEntries(
      Object.entries(reasonCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    samples: rows.slice(0, limit),
  };
}
