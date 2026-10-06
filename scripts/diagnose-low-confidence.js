import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { diagnoseLowConfidenceListings } from "../src/application/listings/diagnose-low-confidence.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";
import { openDatabase } from "./migrate.js";

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

const databasePath = resolve(process.env.DATABASE_PATH ?? process.argv[2] ?? "old-guitar-bye.sqlite");
const lookbackDays = parsePositiveInteger(process.env.IDENTITY_DIAGNOSTIC_LOOKBACK_DAYS, 30, "IDENTITY_DIAGNOSTIC_LOOKBACK_DAYS");
const limit = parsePositiveInteger(process.env.IDENTITY_DIAGNOSTIC_LIMIT, 30, "IDENTITY_DIAGNOSTIC_LIMIT");

if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);

const database = openDatabase(databasePath);
try {
  const listings = listListingsByMarketplace(database, "BUNJANG");
  console.log(JSON.stringify({
    databasePath,
    marketplace: "BUNJANG",
    ...diagnoseLowConfidenceListings({ listings, lookbackDays, limit }),
  }, null, 2));
} finally {
  database.close();
}
