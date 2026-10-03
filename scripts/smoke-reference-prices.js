import { createAcousticMartSource } from "../src/integrations/new-price/acousticmart-source.js";
import { createMovlandSource } from "../src/integrations/new-price/movland-source.js";
import { createReferenceNewPriceResolver } from "../src/integrations/new-price/reference-price-resolver.js";
import {
  calculateUsedToNewRatio,
} from "../src/domain/listing/reference-new-price.js";
import { normalizeGuitarIdentity } from "../src/domain/listing/guitar-identity.js";
import {
  classifyListingRelevance,
  LISTING_RELEVANCE,
} from "../src/domain/listing/listing-relevance.js";
import {
  createBunjangClient,
} from "../src/integrations/bunjang/bunjang-client.js";
import {
  collectBunjangListingCandidates,
} from "../src/integrations/bunjang/bunjang-collector.js";

const collected = await collectBunjangListingCandidates({
  client: createBunjangClient(),
  keywords: ["통기타"],
  resultsPerKeyword: 5,
  enrichDetails: true,
});

const resolver = createReferenceNewPriceResolver({
  sources: [
    createAcousticMartSource(),
    createMovlandSource(),
  ],
});

const results = [];
for (const candidate of collected.candidates) {
  const relevance = classifyListingRelevance({
    title: candidate.title,
    description: candidate.description,
  });
  if (relevance.relevance === LISTING_RELEVANCE.IRRELEVANT) {
    continue;
  }

  const identity = normalizeGuitarIdentity({
    title: candidate.title,
    description: candidate.description,
    guitarType: relevance.guitarType,
  });
  if (!identity.brand || !identity.model) {
    results.push({
      title: candidate.title,
      relevance: relevance.relevance,
      guitarType: relevance.guitarType,
      brand: identity.brand,
      model: identity.model,
      askingPriceKrw: candidate.priceKrw,
      referenceNewPriceKrw: null,
      ratioPct: null,
      decision: "UNRESOLVED",
      referenceConfidence: "LOW",
      sourceUrls: [],
      reasons: ["IDENTITY_UNRESOLVED"],
    });
    continue;
  }

  const reference = await resolver.resolve({
    brand: identity.brand,
    model: identity.model,
  });
  const ratio = calculateUsedToNewRatio({
    askingPriceKrw: candidate.priceKrw,
    referenceNewPriceKrw: reference.referenceNewPriceKrw,
    referenceConfidence: reference.confidence,
  });

  results.push({
    title: candidate.title,
    relevance: relevance.relevance,
    guitarType: relevance.guitarType,
    brand: identity.brand,
    model: identity.model,
    askingPriceKrw: candidate.priceKrw,
    referenceNewPriceKrw: reference.referenceNewPriceKrw,
    ratioPct: ratio.percentage,
    decision: ratio.decision,
    referenceConfidence: reference.confidence,
    sourceUrls: [...new Set(reference.sources.map(({ url }) => url))],
    sourcePrices: reference.sourcePrices,
    sourceErrors: reference.sourceErrors,
  });
}

const recentObservedTargets = [
  {
    title: "크래프터 DX-25 RS PRIMR 탑솔리드 통기타",
    brand: "CRAFTER",
    model: "DX25",
    askingPriceKrw: 200000,
  },
  {
    title: "크래프터 GCL-80 탑솔리드 통기타",
    brand: "CRAFTER",
    model: "GCL80",
    askingPriceKrw: 150000,
  },
  {
    title: "크래프터통기타 OMEGA CSP Plus",
    brand: "CRAFTER",
    model: "OMEGA CSP PLUS",
    askingPriceKrw: 120000,
  },
  {
    title: "세고비아 클래식 기타 판매합니다.",
    brand: "SEGOVIA",
    model: "VC01",
    askingPriceKrw: 30000,
  },
];

const recentKnownResults = [];
for (const target of recentObservedTargets) {
  const reference = await resolver.resolve({
    brand: target.brand,
    model: target.model,
  });
  const ratio = calculateUsedToNewRatio({
    askingPriceKrw: target.askingPriceKrw,
    referenceNewPriceKrw: reference.referenceNewPriceKrw,
    referenceConfidence: reference.confidence,
  });
  recentKnownResults.push({
    ...target,
    referenceNewPriceKrw: reference.referenceNewPriceKrw,
    ratioPct: ratio.percentage,
    decision: ratio.decision,
    referenceConfidence: reference.confidence,
    sourceUrls: [...new Set(reference.sources.map(({ url }) => url))],
    sourcePrices: reference.sourcePrices,
    sourceErrors: reference.sourceErrors,
  });
}

console.log("REFERENCE_PRICE_SMOKE=" + JSON.stringify({
  success: true,
  candidateCount: collected.candidates.length,
  evaluatedCount: results.length,
  decisionCounts: Object.fromEntries(
    ["TRACK", "IGNORE", "UNRESOLVED"].map((decision) => [
      decision,
      results.filter((result) => result.decision === decision).length,
    ]),
  ),
  results,
  recentKnownResults,
  recentDecisionCounts: Object.fromEntries(
    ["TRACK", "IGNORE", "UNRESOLVED"].map((decision) => [
      decision,
      recentKnownResults.filter((result) => result.decision === decision).length,
    ]),
  ),
}));
