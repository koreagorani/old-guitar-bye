import { saveOrUpdateListing } from "../../repositories/listing-repository.js";
import {
  inspectDaangnSearchHtml,
  parseDaangnSearchHtml,
  toListingRecord,
} from "./daangn-parser.js";

export class DaangnSuppressedResponseError extends Error {
  constructor(message, { sourceUrl = null } = {}) {
    super(message);
    this.name = "DaangnSuppressedResponseError";
    this.sourceUrl = sourceUrl;
  }
}

function assertKeywords(keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0
    || keywords.some((keyword) => typeof keyword !== "string"
      || keyword.trim() === "")) {
    throw new TypeError("keywords must be a non-empty string array");
  }
}

export async function collectDaangnListingCandidates({
  client,
  keywords,
  region = null,
  resultsPerKeyword = 20,
  now = () => new Date(),
}) {
  if (!client || typeof client.search !== "function") {
    throw new TypeError("client.search must be a function");
  }
  assertKeywords(keywords);
  if (!Number.isSafeInteger(resultsPerKeyword) || resultsPerKeyword <= 0) {
    throw new TypeError("resultsPerKeyword must be a positive safe integer");
  }

  let resolvedRegion = null;
  if (region !== null) {
    if (typeof client.resolveRegion !== "function") {
      throw new TypeError("client.resolveRegion must be a function");
    }
    resolvedRegion = await client.resolveRegion(region);
    if (!resolvedRegion) {
      throw new Error(`Daangn region not found: ${region}`);
    }
  }

  const discoveredAt = now().toISOString();
  const byExternalId = new Map();
  const sources = [];

  for (const keyword of keywords) {
    const result = await client.search({
      keyword,
      regionSlug: resolvedRegion?.slug ?? null,
    });
    sources.push({
      keyword,
      sourceUrl: result.sourceUrl,
      region: resolvedRegion,
    });
    const inspection = inspectDaangnSearchHtml(result.html);
    if (inspection.articleContainerFound
      && inspection.articleCount === 0
      && inspection.productAdsCount === 0) {
      throw new DaangnSuppressedResponseError(
        "Daangn returned an empty article list and empty ad slots; response appears suppressed",
        { sourceUrl: result.sourceUrl },
      );
    }

    const candidates = parseDaangnSearchHtml(result.html, {
      keyword,
      discoveredAt,
      sourceUrl: result.sourceUrl,
    }).slice(0, resultsPerKeyword);

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
    resolvedRegion,
    discoveredAt,
  };
}

export function persistDaangnListingCandidates(
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
