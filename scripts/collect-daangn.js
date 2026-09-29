import { resolve } from "node:path";

import { applyMigrations, openDatabase } from "./migrate.js";
import { createDaangnClient } from "../src/integrations/daangn/daangn-client.js";
import { loadDaangnConfig } from "../src/integrations/daangn/daangn-config.js";
import {
  collectDaangnListingCandidates,
  persistDaangnListingCandidates,
} from "../src/integrations/daangn/daangn-collector.js";

const databasePath = resolve(
  process.env.DATABASE_PATH ?? process.argv[2] ?? "old-guitar-bye.sqlite",
);
const config = loadDaangnConfig();
const database = openDatabase(databasePath);

try {
  applyMigrations(database);
  const collected = await collectDaangnListingCandidates({
    client: createDaangnClient(),
    ...config,
  });
  const persisted = persistDaangnListingCandidates(
    database,
    collected.candidates,
    { lastSeenAt: collected.discoveredAt },
  );
  console.log(JSON.stringify({
    keywords: config.keywords,
    region: collected.resolvedRegion,
    sourceCount: collected.sources.length,
    candidateCount: collected.candidates.length,
    savedCount: persisted.saved.length,
    skipped: persisted.skipped,
    sample: collected.candidates.slice(0, 5),
  }, null, 2));
} finally {
  database.close();
}
