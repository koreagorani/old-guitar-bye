import { resolve } from "node:path";

import { applyMigrations, openDatabase } from "./migrate.js";
import { createBunjangClient } from "../src/integrations/bunjang/bunjang-client.js";
import { loadBunjangConfig } from "../src/integrations/bunjang/bunjang-config.js";
import {
  collectBunjangListingCandidates,
  persistBunjangListingCandidates,
} from "../src/integrations/bunjang/bunjang-collector.js";

const databasePath = resolve(
  process.env.DATABASE_PATH ?? process.argv[2] ?? "old-guitar-bye.sqlite",
);
const config = loadBunjangConfig();
const database = openDatabase(databasePath);

try {
  applyMigrations(database);
  const collected = await collectBunjangListingCandidates({
    client: createBunjangClient(),
    ...config,
  });
  const persisted = persistBunjangListingCandidates(
    database,
    collected.candidates,
    { lastSeenAt: collected.discoveredAt },
  );

  console.log(JSON.stringify({
    keywords: config.keywords,
    sourceCount: collected.sources.length,
    candidateCount: collected.candidates.length,
    savedCount: persisted.saved.length,
    skipped: persisted.skipped,
    sample: collected.candidates.slice(0, 5),
  }, null, 2));
} finally {
  database.close();
}
