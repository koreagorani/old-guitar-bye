import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations, openDatabase } from "./migrate.js";
import { normalizeGuitarIdentity } from "../src/domain/listing/guitar-identity.js";
import {
  classifyListingRelevance,
  LISTING_RELEVANCE,
} from "../src/domain/listing/listing-relevance.js";
import {
  BunjangAccessError,
  createBunjangClient,
} from "../src/integrations/bunjang/bunjang-client.js";
import {
  collectBunjangListingCandidates,
  persistBunjangListingCandidates,
} from "../src/integrations/bunjang/bunjang-collector.js";

const directory = mkdtempSync(join(tmpdir(), "bunjang-live-smoke-"));
const database = openDatabase(join(directory, "smoke.sqlite"));

try {
  applyMigrations(database);
  const collected = await collectBunjangListingCandidates({
    client: createBunjangClient(),
    keywords: ["통기타"],
    resultsPerKeyword: 5,
    enrichDetails: true,
  });
  const persisted = persistBunjangListingCandidates(
    database,
    collected.candidates,
    { lastSeenAt: collected.discoveredAt },
  );
  const savedIds = new Set(
    persisted.saved.map(({ externalListingId }) => externalListingId),
  );

  const classifications = collected.candidates.map((candidate) =>
    classifyListingRelevance({
      title: candidate.title,
      description: candidate.description,
    }));
  console.log("BUNJANG_SMOKE_RESULT=" + JSON.stringify({
    success: true,
    requests: 1 + collected.candidates.length,
    candidateCount: collected.candidates.length,
    uniqueExternalIdCount: new Set(
      collected.candidates.map(({ externalListingId }) => externalListingId),
    ).size,
    savedCount: persisted.saved.length,
    skipped: persisted.skipped,
    relevanceCounts: Object.fromEntries(
      ["RELEVANT", "IRRELEVANT", "UNCERTAIN"].map((value) => [
        value,
        classifications.filter(({ relevance }) => relevance === value).length,
      ]),
    ),
    samples: collected.candidates.slice(0, 5).map((candidate) => {
      const classification = classifyListingRelevance({
        title: candidate.title,
        description: candidate.description,
      });
      const identity = classification.relevance === LISTING_RELEVANCE.IRRELEVANT
        ? null
        : normalizeGuitarIdentity({
          title: candidate.title,
          description: candidate.description,
          guitarType: classification.guitarType,
        });
      return {
        title: candidate.title,
        priceKrw: candidate.priceKrw,
        locationText: candidate.locationText,
        url: candidate.url,
        externalListingId: candidate.externalListingId,
        status: candidate.status,
        postedAt: candidate.postedAt,
        sellerName: candidate.sellerName,
        dbSaved: savedIds.has(candidate.externalListingId),
        classification,
        identity,
      };
    }),
  }));
} catch (error) {
  console.log("BUNJANG_SMOKE_RESULT=" + JSON.stringify({
    success: false,
    blocked: error instanceof BunjangAccessError,
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    status: error?.status ?? null,
    url: error?.url ?? null,
  }));
  process.exitCode = 2;
} finally {
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
