import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { openDatabase } from "./migrate.js";
import { analyzeReferenceCoverage } from "../src/application/listings/analyze-reference-coverage.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";
import { createAcousticMartSource } from "../src/integrations/new-price/acousticmart-source.js";
import { createMovlandSource } from "../src/integrations/new-price/movland-source.js";
import { createBuzzbeeSource } from "../src/integrations/new-price/buzzbee-source.js";
import { createGopherwoodSource } from "../src/integrations/new-price/gopherwood-source.js";
import { createReferenceNewPriceResolver } from "../src/integrations/new-price/reference-price-resolver.js";

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

const databasePath = resolve(
  process.env.DATABASE_PATH ?? process.argv[2] ?? "old-guitar-bye.sqlite",
);
const lookbackDays = parsePositiveInteger(
  process.env.REFERENCE_COVERAGE_LOOKBACK_DAYS,
  30,
  "REFERENCE_COVERAGE_LOOKBACK_DAYS",
);
const exampleTitleLimit = parsePositiveInteger(
  process.env.REFERENCE_COVERAGE_EXAMPLE_TITLES,
  3,
  "REFERENCE_COVERAGE_EXAMPLE_TITLES",
);

if (!existsSync(databasePath)) {
  throw new Error(`Database does not exist: ${databasePath}`);
}

const database = openDatabase(databasePath);
try {
  const listings = listListingsByMarketplace(database, "BUNJANG");
  const resolver = createReferenceNewPriceResolver({
    sources: [
      createAcousticMartSource(),
      createMovlandSource(),
      createBuzzbeeSource(),
      createGopherwoodSource(),
    ],
  });
  const analysis = await analyzeReferenceCoverage({
    listings,
    resolver,
    lookbackDays,
    exampleTitleLimit,
  });

  console.log(JSON.stringify({
    databasePath,
    marketplace: "BUNJANG",
    ...analysis,
    topUnresolved: analysis.aggregates
      .filter(({ unresolvedCount }) => unresolvedCount > 0)
      .slice(0, 10),
  }, null, 2));
} finally {
  database.close();
}
