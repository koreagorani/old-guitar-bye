import { normalizeGuitarIdentity } from "../../domain/listing/guitar-identity.js";
import { classifyListingRelevance } from "../../domain/listing/listing-relevance.js";
import { redactListingText } from "./diagnose-uncertain.js";

const MIN_REQUEST_INTERVAL_MS = 1500;
const MAX_PROBE_LIMIT = 30;

function identitySummary(identity) {
  return {
    brand: identity.brand,
    model: identity.model ? redactListingText(identity.model) : null,
    variant: identity.variant,
    confidence: identity.confidence,
    reasons: identity.reasons,
  };
}

function percent(numerator, denominator) {
  return denominator ? Number((numerator / denominator * 100).toFixed(2)) : null;
}

function failureReason(error) {
  if (error?.name === "BunjangAccessError" && /access challenge/i.test(error.message)) {
    return "ACCESS_CHALLENGE";
  }
  const status = error?.status;
  return Number.isSafeInteger(status) && status >= 400 && status <= 599
    ? `HTTP_${status}` : "REQUEST_OR_PARSE_ERROR";
}

export async function probeUncertainDetails({
  sample,
  listings,
  client,
  merge,
  limit = 3,
  wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
  clock = () => performance.now(),
}) {
  if (!Array.isArray(sample) || !Array.isArray(listings)) {
    throw new TypeError("sample and listings must be arrays");
  }
  if (typeof client?.detail !== "function" || typeof merge !== "function") {
    throw new TypeError("detail client and merge are required");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PROBE_LIMIT) {
    throw new TypeError("probe limit must be an integer from 1 to 30");
  }

  const original = new Map(listings.map((row) => [row.externalListingId, row]));
  const seen = new Set();
  const selected = sample.filter((row) => {
    if (row.originalDetail !== "MISSING_DATA" || !original.has(row.externalListingId)
      || seen.has(row.externalListingId)) return false;
    seen.add(row.externalListingId);
    return true;
  }).slice(0, limit);
  const results = [];
  let previousFailure = null;
  let consecutiveFailures = 0;
  let stopReason = null;

  for (const [index, row] of selected.entries()) {
    if (index) await wait(MIN_REQUEST_INTERVAL_MS);
    const started = clock();
    const listing = original.get(row.externalListingId);
    const beforeRelevance = classifyListingRelevance(listing);
    const beforeIdentity = normalizeGuitarIdentity({
      title: listing.title,
      description: listing.description,
      guitarType: beforeRelevance.guitarType,
    });
    const common = {
      externalListingId: row.externalListingId,
      url: row.url,
      title: row.title,
      before: {
        relevance: beforeRelevance.relevance,
        relevanceReasons: beforeRelevance.reasons,
        identity: identitySummary(beforeIdentity),
      },
      manualReview: "NOT_REVIEWED",
    };

    try {
      const response = await client.detail(row.externalListingId);
      const responseElapsedMs = Math.round(clock() - started);
      const enriched = merge({
        externalListingId: row.externalListingId,
        title: listing.title,
        description: listing.description,
        locationText: null,
        sellerName: null,
        sourceMetadata: {},
      }, response.data);
      if (!enriched.sourceMetadata?.detailLoaded) {
        results.push({ ...common, status: "DETAIL_UNAVAILABLE", errorReason: "DETAIL_UNAVAILABLE",
          elapsedMs: responseElapsedMs });
        consecutiveFailures = previousFailure === "DETAIL_UNAVAILABLE" ? consecutiveFailures + 1 : 1;
        previousFailure = "DETAIL_UNAVAILABLE";
      } else {
        const description = enriched.description ?? "";
        const afterRelevance = classifyListingRelevance({ title: listing.title, description });
        const afterIdentity = normalizeGuitarIdentity({
          title: listing.title,
          description,
          guitarType: afterRelevance.guitarType,
        });
        const addedBrand = !beforeIdentity.brand && afterIdentity.brand ? afterIdentity.brand : null;
        const addedModel = !beforeIdentity.model && afterIdentity.model ? afterIdentity.model : null;
        results.push({
          ...common,
          status: "DETAIL_LOADED",
          detailTitle: enriched.title !== listing.title ? redactListingText(enriched.title) : null,
          description: redactListingText(description),
          descriptionPresent: description.trim().length > 0,
          descriptionLength: description.length,
          after: {
            relevance: afterRelevance.relevance,
            relevanceReasons: afterRelevance.reasons,
            identity: identitySummary(afterIdentity),
          },
          addedFromDescription: {
            brand: addedBrand,
            model: addedModel ? redactListingText(addedModel) : null,
            guitarType: beforeRelevance.guitarType === "UNKNOWN"
              && afterRelevance.guitarType !== "UNKNOWN" ? afterRelevance.guitarType : null,
            relevanceReasons: afterRelevance.reasons.filter((reason) =>
              !beforeRelevance.reasons.includes(reason)),
          },
          automaticAnalysis: "CLASSIFIER_" + afterRelevance.relevance,
          elapsedMs: responseElapsedMs,
        });
        previousFailure = null;
        consecutiveFailures = 0;
      }
    } catch (error) {
      const reason = failureReason(error);
      results.push({ ...common, status: "REQUEST_FAILED", errorReason: reason,
        httpStatus: Number.isSafeInteger(error?.status) ? error.status : null,
        elapsedMs: Math.round(clock() - started) });
      consecutiveFailures = reason === previousFailure ? consecutiveFailures + 1 : 1;
      previousFailure = reason;
    }

    if (previousFailure === "HTTP_403" || previousFailure === "HTTP_429"
      || previousFailure === "ACCESS_CHALLENGE"
      || consecutiveFailures >= 2) {
      stopReason = previousFailure === "HTTP_403" || previousFailure === "HTTP_429"
        || previousFailure === "ACCESS_CHALLENGE"
        ? previousFailure : `REPEATED_${previousFailure}`;
      break;
    }
  }

  const loaded = results.filter(({ status }) => status === "DETAIL_LOADED");
  const failures = results.filter(({ errorReason }) => errorReason);
  const errorCounts = {};
  for (const { errorReason } of failures) {
    errorCounts[errorReason] = (errorCounts[errorReason] ?? 0) + 1;
  }
  const durations = results.map(({ elapsedMs }) => elapsedMs);
  return {
    requestedLimit: limit,
    selected: selected.length,
    requests: results.length,
    succeeded: loaded.length,
    failed: failures.length,
    errorCounts,
    stopReason,
    detailsWithDescription: loaded.filter(({ descriptionPresent }) => descriptionPresent).length,
    descriptionPresentPctOfSucceeded: percent(
      loaded.filter(({ descriptionPresent }) => descriptionPresent).length, loaded.length,
    ),
    becameRelevant: loaded.filter(({ before, after }) =>
      before.relevance === "UNCERTAIN" && after.relevance === "RELEVANT").length,
    addedBrand: loaded.filter(({ addedFromDescription }) => addedFromDescription.brand).length,
    addedModel: loaded.filter(({ addedFromDescription }) => addedFromDescription.model).length,
    meanRequestMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    collectorSearchLimit: "기본 설정 3개 검색어 × 검색어당 20건 = 실행당 최대 60건의 상세 요청, 중복 제거 전",
    ifEveryThirtyMinutes: "최대 2,880건의 상세 요청/일, 60건 × 48회. 실제 중복과 실패에 따라 변동",
    results,
  };
}
