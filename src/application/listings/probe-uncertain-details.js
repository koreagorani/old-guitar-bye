import { normalizeGuitarIdentity } from "../../domain/listing/guitar-identity.js";
import { classifyListingRelevance } from "../../domain/listing/listing-relevance.js";

export async function probeUncertainDetails({
  sample,
  listings,
  client,
  merge,
  wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
  clock = () => performance.now(),
}) {
  if (!Array.isArray(sample) || !Array.isArray(listings)) throw new TypeError("sample and listings must be arrays");
  if (typeof client?.detail !== "function" || typeof merge !== "function") throw new TypeError("detail client and merge are required");
  const original = new Map(listings.map((row) => [row.externalListingId, row]));
  const selected = sample.filter((row) => row.originalDetail === "MISSING_DATA")
    .slice(0, 3);
  const results = [];
  for (const [index, row] of selected.entries()) {
    if (index) await wait(1500);
    const started = clock();
    try {
      const detail = await client.detail(row.externalListingId);
      const listing = original.get(row.externalListingId);
      const enriched = merge({
        externalListingId: row.externalListingId,
        title: listing.title,
        description: listing.description,
        locationText: null,
        sellerName: null,
        sourceMetadata: {},
      }, detail.data);
      const description = enriched.sourceMetadata?.detailLoaded ? enriched.description : "";
      const identity = normalizeGuitarIdentity({ title: listing.title, description });
      const titleIdentity = normalizeGuitarIdentity({ title: listing.title });
      results.push({
        externalListingId: row.externalListingId,
        url: row.url,
        status: enriched.sourceMetadata?.detailLoaded ? "DETAIL_LOADED" : "DETAIL_UNAVAILABLE",
        descriptionPresent: Boolean(description?.trim()),
        descriptionLength: description?.trim().length ?? 0,
        addedBrand: !titleIdentity.brand && identity.brand ? identity.brand : null,
        addedModel: !titleIdentity.model && identity.model ? identity.model : null,
        relevanceAfterDetail: description?.trim()
          ? classifyListingRelevance({ title: listing.title, description }).relevance : null,
        elapsedMs: Math.round(clock() - started),
      });
    } catch (error) {
      results.push({
        externalListingId: row.externalListingId,
        url: row.url,
        status: "REQUEST_FAILED",
        httpStatus: error?.status ?? null,
        elapsedMs: Math.round(clock() - started),
      });
    }
  }
  const durations = results.map(({ elapsedMs }) => elapsedMs);
  return {
    requests: results.length,
    failed: results.filter(({ status }) => status === "REQUEST_FAILED").length,
    detailsWithDescription: results.filter(({ descriptionPresent }) => descriptionPresent).length,
    meanRequestMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    collectorSearchLimit: "기본 설정 3개 검색어 × 검색어당 20건 = 실행당 최대 60건의 상세 요청, 중복 제거 전",
    ifEveryThirtyMinutes: "최대 2,880건의 상세 요청/일, 60건 × 48회. 실제 중복과 실패에 따라 변동",
    results,
  };
}
