import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations, openDatabase } from "./migrate.js";
import {
  createDaangnClient,
  DaangnAccessError,
} from "../src/integrations/daangn/daangn-client.js";
import {
  collectDaangnListingCandidates,
  DaangnSuppressedResponseError,
  persistDaangnListingCandidates,
} from "../src/integrations/daangn/daangn-collector.js";

const keywords = ["통기타"];
const smokeRegion = "역삼동";
const directory = mkdtempSync(join(tmpdir(), "daangn-live-smoke-"));
const databasePath = join(directory, "smoke.sqlite");
const database = openDatabase(databasePath);

try {
  applyMigrations(database);
  const collected = await collectDaangnListingCandidates({
    client: createDaangnClient(),
    keywords,
    region: smokeRegion,
    resultsPerKeyword: 5,
  });
  const persisted = persistDaangnListingCandidates(
    database,
    collected.candidates,
    { lastSeenAt: collected.discoveredAt },
  );
  const savedIds = new Set(persisted.saved.map(({ externalListingId }) => externalListingId));
  const statusCounts = Object.create(null);
  for (const candidate of collected.candidates) {
    const status = candidate.status ?? candidate.sourceMetadata.status ?? "UNKNOWN";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  const samples = collected.candidates.slice(0, 5).map((candidate) => ({
    title: candidate.title,
    priceKrw: candidate.priceKrw,
    locationText: candidate.locationText,
    url: candidate.url,
    externalListingId: candidate.externalListingId,
    status: candidate.status,
    dbSaved: savedIds.has(candidate.externalListingId),
  }));

  console.log("DAANGN_SMOKE_RESULT=" + JSON.stringify({
    success: true,
    parserShape: "remix-loaderData-buySellArticles",
    keywords,
    region: collected.resolvedRegion,
    requests: collected.sources.length,
    candidateCount: collected.candidates.length,
    uniqueExternalIdCount: new Set(
      collected.candidates.map(({ externalListingId }) => externalListingId),
    ).size,
    savedCount: persisted.saved.length,
    skipped: persisted.skipped,
    statusCounts,
    samples,
  }));
} catch (error) {
  const result = {
    success: false,
    blocked: error instanceof DaangnAccessError
      || error instanceof DaangnSuppressedResponseError,
    suppressed: error instanceof DaangnSuppressedResponseError,
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    status: error?.status ?? null,
    url: error?.url ?? error?.sourceUrl ?? null,
  };
  console.log("DAANGN_SMOKE_RESULT=" + JSON.stringify(result));
  process.exitCode = 2;
} finally {
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
