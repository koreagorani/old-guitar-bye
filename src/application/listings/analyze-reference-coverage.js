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

function cutoffIso({ now, lookbackDays }) {
  const nowDate = now();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.getTime())) {
    throw new TypeError("now() must return a valid Date");
  }
  return new Date(nowDate.getTime() - lookbackDays * 86400000).toISOString();
}

function compareNullableIsoDesc(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b.localeCompare(a);
}

function sortAggregates(a, b) {
  return (
    b.unresolvedCount - a.unresolvedCount
    || b.listingCount - a.listingCount
    || compareNullableIsoDesc(a.latestSeenAt, b.latestSeenAt)
    || a.brand.localeCompare(b.brand)
    || a.model.localeCompare(b.model)
  );
}

function limitedExamples(titles, limit) {
  const seen = new Set();
  const result = [];
  for (const title of titles) {
    if (seen.has(title)) continue;
    seen.add(title);
    result.push(title);
    if (result.length >= limit) break;
  }
  return result;
}

export async function analyzeReferenceCoverage({
  listings,
  resolver,
  lookbackDays = 30,
  exampleTitleLimit = 3,
  now = () => new Date(),
}) {
  if (!Array.isArray(listings)) {
    throw new TypeError("listings must be an array");
  }
  if (!resolver || typeof resolver.resolve !== "function") {
    throw new TypeError("resolver.resolve must be a function");
  }
  assertPositiveInteger(lookbackDays, "lookbackDays");
  assertPositiveInteger(exampleTitleLimit, "exampleTitleLimit");

  const cutoff = cutoffIso({ now, lookbackDays });
  const eligible = [];
  let lowConfidenceCount = 0;
  let irrelevantCount = 0;
  let staleCount = 0;
  let identityIncompleteCount = 0;

  for (const listing of listings) {
    if (typeof listing?.lastSeenAt !== "string" || listing.lastSeenAt < cutoff) {
      staleCount += 1;
      continue;
    }

    const relevance = classifyListingRelevance({
      title: listing.title,
      description: listing.description,
    });
    if (relevance.relevance === LISTING_RELEVANCE.IRRELEVANT) {
      irrelevantCount += 1;
      continue;
    }

    const identity = normalizeGuitarIdentity({
      title: listing.title,
      description: listing.description,
      guitarType: relevance.guitarType,
    });
    if (!identity.brand || !identity.model) {
      identityIncompleteCount += 1;
      continue;
    }
    if (identity.confidence === IDENTITY_CONFIDENCE.LOW) {
      lowConfidenceCount += 1;
      continue;
    }

    eligible.push({
      listing,
      identity,
    });
  }

  const groups = new Map();
  for (const item of eligible) {
    const key = `${item.identity.brand}\u0000${item.identity.model}`;
    const group = groups.get(key) ?? {
      brand: item.identity.brand,
      model: item.identity.model,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }

  const resolvedByKey = new Map();
  for (const [key, group] of groups) {
    const reference = await resolver.resolve({
      brand: group.brand,
      model: group.model,
    });
    resolvedByKey.set(key, reference);
  }

  const aggregates = [];
  let resolvedListings = 0;
  let unresolvedListings = 0;

  for (const [key, group] of groups) {
    const reference = resolvedByKey.get(key);
    const isResolved = Number.isFinite(reference?.referenceNewPriceKrw)
      && reference.referenceNewPriceKrw > 0;
    const listingCount = group.items.length;
    const resolvedCount = isResolved ? listingCount : 0;
    const unresolvedCount = isResolved ? 0 : listingCount;
    resolvedListings += resolvedCount;
    unresolvedListings += unresolvedCount;

    const latestSeenAt = group.items
      .map(({ listing }) => listing.lastSeenAt)
      .filter((value) => typeof value === "string")
      .sort()
      .at(-1) ?? null;

    const titles = group.items
      .slice()
      .sort((a, b) => b.listing.lastSeenAt.localeCompare(a.listing.lastSeenAt))
      .map(({ listing }) => listing.title);

    aggregates.push({
      brand: group.brand,
      model: group.model,
      listingCount,
      resolvedCount,
      unresolvedCount,
      unresolvedRate: listingCount === 0 ? 0 : unresolvedCount / listingCount,
      latestSeenAt,
      exampleTitles: limitedExamples(titles, exampleTitleLimit),
      referenceNewPriceKrw: isResolved ? reference.referenceNewPriceKrw : null,
      referenceConfidence: reference?.confidence ?? "LOW",
    });
  }

  aggregates.sort(sortAggregates);

  const identifiedListings = eligible.length;
  const uniqueBrandModelCount = aggregates.length;
  const unresolvedUniqueModelCount = aggregates.filter(
    ({ unresolvedCount }) => unresolvedCount > 0,
  ).length;

  const brandMap = new Map();
  for (const row of aggregates) {
    const brand = brandMap.get(row.brand) ?? {
      brand: row.brand,
      listingCount: 0,
      resolvedCount: 0,
      unresolvedCount: 0,
      models: [],
    };
    brand.listingCount += row.listingCount;
    brand.resolvedCount += row.resolvedCount;
    brand.unresolvedCount += row.unresolvedCount;
    brand.models.push({
      model: row.model,
      listingCount: row.listingCount,
      resolvedCount: row.resolvedCount,
      unresolvedCount: row.unresolvedCount,
      unresolvedRate: row.unresolvedRate,
      latestSeenAt: row.latestSeenAt,
    });
    brandMap.set(row.brand, brand);
  }

  const brands = [...brandMap.values()]
    .map((brand) => ({
      ...brand,
      resolvedRate: brand.listingCount === 0
        ? 0
        : brand.resolvedCount / brand.listingCount,
      unresolvedRate: brand.listingCount === 0
        ? 0
        : brand.unresolvedCount / brand.listingCount,
      models: brand.models.sort((a, b) => (
        b.unresolvedCount - a.unresolvedCount
        || b.listingCount - a.listingCount
        || compareNullableIsoDesc(a.latestSeenAt, b.latestSeenAt)
        || a.model.localeCompare(b.model)
      )),
    }))
    .sort((a, b) => (
      b.unresolvedCount - a.unresolvedCount
      || b.listingCount - a.listingCount
      || a.brand.localeCompare(b.brand)
    ));

  return {
    lookbackDays,
    cutoff,
    summary: {
      totalInputListings: listings.length,
      staleListings: staleCount,
      irrelevantListings: irrelevantCount,
      identityIncompleteListings: identityIncompleteCount,
      lowConfidenceListings: lowConfidenceCount,
      totalIdentifiedListings: identifiedListings,
      resolvedListings,
      unresolvedListings,
      resolvedRate: identifiedListings === 0 ? 0 : resolvedListings / identifiedListings,
      unresolvedRate: identifiedListings === 0 ? 0 : unresolvedListings / identifiedListings,
      uniqueBrandModelCount,
      unresolvedUniqueModelCount,
    },
    aggregates,
    brands,
  };
}
