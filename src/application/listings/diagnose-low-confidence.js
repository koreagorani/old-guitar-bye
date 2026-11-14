import { IDENTITY_CONFIDENCE, normalizeGuitarIdentity } from "../../domain/listing/guitar-identity.js";
import { GUITAR_BRAND_ALIASES } from "../../domain/listing/guitar-brand-aliases.js";
import {
  classifyListingRelevance,
  LISTING_RELEVANCE,
} from "../../domain/listing/listing-relevance.js";

const REVIEW = {
  AMBIGUOUS_BRAND: "High risk: verify comparison brands, bundles, and the actual guitar.",
  BRAND_CONFLICT: "High risk: verify the instrument label against the title and description.",
  MULTIPLE_MODEL_CANDIDATES: "High risk: distinguish the guitar model from included gear and serial numbers.",
  MODEL_CONFLICT: "High risk: confirm model and variant before looking up a reference price.",
  MODEL_ONLY: "High risk: verify the maker independently, since model codes can recur across brands.",
  BRAND_ONLY: "Review repeated spellings under the known brand. Series names may cover several models or variants.",
  NO_IDENTITY: "High risk: check guitar relevance and whether the model is visible only in photos.",
  DESCRIPTION_ONLY: "Verify that the description refers to the guitar itself.",
  OTHER_LOW: "Review the original listing before changing a rule.",
};

const ALIAS_WORDS = new Set(Object.values(GUITAR_BRAND_ALIASES).flat()
  .flatMap((alias) => alias.toUpperCase().split(/\s+/)));
const GENERIC_WORDS = new Set(["GUITAR", "ACOUSTIC", "ELECTRIC", "CLASSICAL", "BASS", "SALE", "KRW"]);

function assertPositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
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

// Diagnostic hints only. Keep the literal spelling for review and never feed it to the evaluator.
function titleHints(title) {
  const normalized = title.normalize("NFKC").toUpperCase();
  const codes = normalized.match(/(?<![A-Z0-9])(?:[A-Z]{1,12}[- _]?\d{1,5}[A-Z]{0,5}(?:[-_][A-Z0-9]{1,8})*|[가-힣]{2,10}[- _]?\d{1,5}[A-Z]{0,5}|\d{1,4}[A-Z]{1,5})(?![A-Z0-9])/gu) ?? [];
  const words = (normalized.match(/\b[A-Z]{3,20}\b/g) ?? [])
    .filter((word) => !ALIAS_WORDS.has(word) && !GENERIC_WORDS.has(word));
  return [...new Set([...codes, ...words])];
}

function increment(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function ranked(counts) {
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
}

function priceDistribution(failures) {
  const prices = failures.map(({ askingPriceKrw }) => askingPriceKrw)
    .filter((price) => Number.isSafeInteger(price) && price > 0)
    .sort((a, b) => a - b);
  const percentile = (p) => prices.length ? prices[Math.ceil(prices.length * p) - 1] : null;
  return {
    positiveCount: prices.length,
    zeroOrInvalidCount: failures.length - prices.length,
    min: prices[0] ?? null,
    p25: percentile(0.25),
    median: percentile(0.5),
    p75: percentile(0.75),
    max: prices.at(-1) ?? null,
  };
}

function summarize(rows, limit) {
  const failures = [];
  const reasons = new Map();
  const relevanceCounts = new Map();
  const brands = new Map();
  const priorityGroups = new Map();
  let irrelevant = 0;

  for (const row of rows) {
    if (row.relevance === LISTING_RELEVANCE.IRRELEVANT) {
      irrelevant += 1;
      continue;
    }

    const brand = row.brand ?? null;
    const group = brands.get(brand) ?? { count: 0, failures: [], hints: new Map() };
    brands.set(brand, group);
    group.count += 1;
    if (!row.lowReason) continue;

    failures.push(row);
    group.failures.push(row);
    increment(reasons, row.lowReason);
    increment(relevanceCounts, row.relevance);
    for (const hint of row.titleModelHints) increment(group.hints, hint);

    const key = JSON.stringify([brand, row.lowReason]);
    const priority = priorityGroups.get(key) ?? {
      brand,
      reason: row.lowReason,
      relevant: 0,
      uncertain: 0,
      sample: row,
      reviewRisk: REVIEW[row.lowReason],
    };
    priorityGroups.set(key, priority);
    if (row.relevance === LISTING_RELEVANCE.RELEVANT) {
      if (priority.relevant === 0) priority.sample = row;
      priority.relevant += 1;
    } else {
      priority.uncertain += 1;
    }
  }

  return {
    totalListings: rows.length,
    irrelevant,
    identityActionableCount: rows.length - irrelevant - failures.length,
    lowConfidenceCount: failures.length,
    reasonCounts: Object.fromEntries(ranked(reasons)),
    failureRelevanceCounts: Object.fromEntries(ranked(relevanceCounts)),
    askingPriceKrw: priceDistribution(failures),
    byBrand: [...brands].map(([brand, group]) => ({
      brand,
      evaluatedCount: group.count,
      failureCount: group.failures.length,
      failureRatePct: 100 * group.failures.length / group.count,
      askingPriceKrw: priceDistribution(group.failures),
      titleModelHints: ranked(group.hints).slice(0, limit)
        .map(([hint, count]) => ({ hint, count })),
    })).sort((a, b) => b.failureCount - a.failureCount
      || (a.brand ?? "").localeCompare(b.brand ?? "")),
    reviewPriorities: [...priorityGroups.values()].sort((a, b) =>
      b.relevant - a.relevant || b.uncertain - a.uncertain).slice(0, limit),
    samples: failures.slice(0, limit),
  };
}

function diagnoseListing(listing) {
  const relevance = classifyListingRelevance(listing);
  if (relevance.relevance === LISTING_RELEVANCE.IRRELEVANT) {
    return { relevance: relevance.relevance, lastSeenAt: listing.lastSeenAt };
  }

  const identity = normalizeGuitarIdentity({ ...listing, guitarType: relevance.guitarType });
  const unresolved = !identity.brand || !identity.model || identity.confidence === IDENTITY_CONFIDENCE.LOW;
  return {
    title: listing.title,
    url: listing.url ?? null,
    askingPriceKrw: listing.askingPriceKrw ?? null,
    relevance: relevance.relevance,
    relevanceReasons: relevance.reasons,
    guitarType: relevance.guitarType,
    ...identity,
    variant: identity.variant ?? null,
    lowReason: unresolved ? classifyLowConfidenceReason(identity) : null,
    titleModelHints: unresolved ? titleHints(listing.title) : [],
    lastSeenAt: listing.lastSeenAt,
  };
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

  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("now() must return a valid Date");
  }
  const cutoff = new Date(date.getTime() - lookbackDays * 86400000).toISOString();
  const rows = listings.map(diagnoseListing).sort((a, b) =>
    (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));

  return {
    lookbackDays,
    cutoff,
    // Keep the existing top-level fields as the recent-window report.
    ...summarize(rows.filter(({ lastSeenAt }) =>
      typeof lastSeenAt === "string" && lastSeenAt >= cutoff), limit),
    allTime: summarize(rows, limit),
  };
}
