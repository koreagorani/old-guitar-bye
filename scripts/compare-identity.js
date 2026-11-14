import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { diagnoseLowConfidenceListings } from "../src/application/listings/diagnose-low-confidence.js";
import { evaluateBunjangOpportunities } from "../src/application/listings/evaluate-bunjang-opportunities.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";
import { createAcousticMartSource } from "../src/integrations/new-price/acousticmart-source.js";
import { createMovlandSource } from "../src/integrations/new-price/movland-source.js";
import { createBuzzbeeSource } from "../src/integrations/new-price/buzzbee-source.js";
import { createGopherwoodSource } from "../src/integrations/new-price/gopherwood-source.js";
import { createReferenceNewPriceResolver } from "../src/integrations/new-price/reference-price-resolver.js";

const [baselineCheckout, databasePath, referenceMode] = process.argv.slice(2);
if (!baselineCheckout || !databasePath || ![undefined, "--live-reference"].includes(referenceMode)) {
  throw new Error("Usage: node scripts/compare-identity.js BASELINE_CHECKOUT SQLITE_PATH [--live-reference]");
}

const baselineModule = (path) => import(pathToFileURL(resolve(baselineCheckout, path)).href);
const baselineDiagnosis = await baselineModule("src/application/listings/diagnose-low-confidence.js");
const baselineEvaluator = await baselineModule("src/application/listings/evaluate-bunjang-opportunities.js");
const baselineResolver = await baselineModule("src/integrations/new-price/reference-price-resolver.js");
const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
let listings;
try {
  listings = listListingsByMarketplace(database, "BUNJANG");
} finally {
  database.close();
}

const asOf = new Date();
const now = () => asOf;
const options = { listings, now };
const sourceErrors = new Map();
const afterReferences = new Map();
const referenceEnabled = referenceMode === "--live-reference";
const sources = referenceEnabled ? [
  createAcousticMartSource(), createMovlandSource(), createBuzzbeeSource(), createGopherwoodSource(),
].map((source) => {
  // Reuse the same retail responses while each revision identifies products with its own rules.
  const observed = new Map();
  return {
    ...source,
    search(args) {
      const key = source.cacheByModel ? JSON.stringify([args.brand, args.model]) : args.brand;
      if (!observed.has(key)) observed.set(key, source.search(args));
      return observed.get(key);
    },
  };
}) : [];

function resolverFor(createResolver, references) {
  if (!referenceEnabled) return { resolve: async () => null };
  const resolver = createResolver({ sources, now });
  return {
    async resolve(args) {
      const reference = await resolver.resolve(args);
      for (const error of reference.sourceErrors) {
        sourceErrors.set(JSON.stringify([args.brand, args.model, error.source]), { ...args, ...error });
      }
      references?.set(JSON.stringify([args.brand, args.model]), reference.sourcePrices);
      return reference;
    },
  };
}

const before = await baselineEvaluator.evaluateBunjangOpportunities({
  ...options, resolver: resolverFor(baselineResolver.createReferenceNewPriceResolver),
});
const after = await evaluateBunjangOpportunities({
  ...options, resolver: resolverFor(createReferenceNewPriceResolver, afterReferences),
});

function metrics(evaluation, diagnosis) {
  const { summary, results } = evaluation;
  const relevance = { RELEVANT: 0, UNCERTAIN: 0, IRRELEVANT: summary.irrelevant };
  const confidence = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const row of results) {
    relevance[row.relevance] += 1;
    confidence[row.identityConfidence] += 1;
  }
  return {
    relevance,
    confidence,
    modelCodeDetected: results.filter(({ model }) => model !== null).length,
    actionableIdentity: diagnosis.identityActionableCount,
    failureReasons: diagnosis.reasonCounts,
    referenceComparable: referenceEnabled ? summary.track + summary.ignore : null,
    track: referenceEnabled ? summary.track : null,
  };
}

const beforeById = new Map(before.results.map((row) => [row.externalListingId, row]));
const afterById = new Map(after.results.map((row) => [row.externalListingId, row]));
const recentListings = listings.filter(({ lastSeenAt }) => lastSeenAt >= after.cutoff);

function reviewRow(result) {
  if (!result) return { relevance: "IRRELEVANT" };
  const { relevance, brand, model, variant, identityConfidence, reasons } = result;
  return { relevance, brand, model, variant, identityConfidence, reasons };
}

const reviewSample = [];
let changedCount = 0;
for (const listing of recentListings) {
  const oldRow = reviewRow(beforeById.get(listing.externalListingId));
  const newRow = reviewRow(afterById.get(listing.externalListingId));
  // Missing results in either revision were rejected by the relevance filter.
  const fields = ["relevance", "brand", "model", "variant", "identityConfidence"];
  if (fields.every((key) => oldRow[key] === newRow[key])) continue;
  changedCount += 1;
  if (reviewSample.length < 30) {
    const { externalListingId, title, url } = listing;
    reviewSample.push({ externalListingId, title, url, before: oldRow, after: newRow });
  }
}

console.log(JSON.stringify({
  asOf: asOf.toISOString(),
  cutoff: after.cutoff,
  thresholdPct: after.thresholdPct,
  recentListings: recentListings.length,
  referenceEnabled,
  before: metrics(before, baselineDiagnosis.diagnoseLowConfidenceListings(options)),
  after: metrics(after, diagnoseLowConfidenceListings(options)),
  newTrack: referenceEnabled ? after.track
    .filter(({ externalListingId }) => beforeById.get(externalListingId)?.decision !== "TRACK")
    .map((row) => ({
      ...row,
      previousDecision: beforeById.get(row.externalListingId)?.decision ?? "IRRELEVANT",
      referenceSources: afterReferences.get(JSON.stringify([row.brand, row.model])),
    })) : null,
  referenceSourceErrors: [...sourceErrors.values()],
  changedCount,
  reviewSample,
}, null, 2));
