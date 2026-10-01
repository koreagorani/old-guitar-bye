import { saveOrUpdateListing } from "../../repositories/listing-repository.js";
import {
  mergeBunjangDetail,
  parseBunjangSearchPayload,
  toListingRecord,
} from "./bunjang-parser.js";

function assertKeywords(keywords) {
  if (!Array.isArray(keywords)
    || keywords.length === 0
    || keywords.some((keyword) => typeof keyword !== "string"
      || keyword.trim() === "")) {
    throw new TypeError("keywords must be a non-empty string array");
  }
}

export async function collectBunjangListingCandidates({
  client,
  keywords,
  resultsPerKeyword = 20,
  enrichDetails = false,
  now = () => new Date(),
}) {
  if (!client || typeof client.search !== "function") {
    throw new TypeError("client.search must be a function");
  }
  assertKeywords(keywords);
  if (!Number.isSafeInteger(resultsPerKeyword)
    || resultsPerKeyword <= 0
    || resultsPerKeyword > 100) {
    throw new TypeError("resultsPerKeyword must be an integer from 1 to 100");
  }
  if (enrichDetails && typeof client.detail !== "function") {
    throw new TypeError("client.detail must be a function when enrichDetails is true");
  }

  const discoveredAt = now().toISOString();
  const byExternalId = new Map();
  const sources = [];

  for (const keyword of keywords) {
    const result = await client.search({
      keyword,
      limit: resultsPerKeyword,
    });
    sources.push({ keyword, sourceUrl: result.sourceUrl });

    let candidates = parseBunjangSearchPayload(result.data, {
      keyword,
      discoveredAt,
      sourceUrl: result.sourceUrl,
    }).slice(0, resultsPerKeyword);

    if (enrichDetails) {
      const enriched = [];
      for (const candidate of candidates) {
        const detail = await client.detail(candidate.externalListingId);
        enriched.push(mergeBunjangDetail(candidate, detail.data));
      }
      candidates = enriched;
    }

    for (const candidate of candidates) {
      const existing = byExternalId.get(candidate.externalListingId);
      if (!existing) {
        byExternalId.set(candidate.externalListingId, {
          ...candidate,
          sourceMetadata: {
            ...candidate.sourceMetadata,
            matchedKeywords: [keyword],
          },
        });
        continue;
      }
      if (!existing.sourceMetadata.matchedKeywords.includes(keyword)) {
        existing.sourceMetadata.matchedKeywords.push(keyword);
      }
    }
  }

  return {
    candidates: [...byExternalId.values()],
    sources,
    discoveredAt,
  };
}

export function persistBunjangListingCandidates(
  database,
  candidates,
  { lastSeenAt } = {},
) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array");
  }

  const saved = [];
  const skipped = [];

  for (const candidate of candidates) {
    const normalized = toListingRecord(candidate, { lastSeenAt });
    if (!normalized.listing) {
      skipped.push({
        externalListingId: candidate?.externalListingId ?? null,
        missing: normalized.missing,
      });
      continue;
    }
    saved.push(saveOrUpdateListing(database, normalized.listing));
  }

  return { saved, skipped };
}
