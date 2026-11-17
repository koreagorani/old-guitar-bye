import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { diagnoseUncertain } from "../src/application/listings/diagnose-uncertain.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";
import { createBunjangClient } from "../src/integrations/bunjang/bunjang-client.js";
import { mergeBunjangDetail } from "../src/integrations/bunjang/bunjang-parser.js";
import { probeUncertainDetails } from "../src/application/listings/probe-uncertain-details.js";

const argumentsProvided = process.argv.slice(2);
const probe = argumentsProvided.includes("--probe-details");
const positional = argumentsProvided.filter((arg) => arg !== "--probe-details");
if (positional.length > 1 || positional.some((arg) => arg.startsWith("--"))) {
  throw new TypeError("Usage: npm run diagnose:uncertain -- [database path] [--probe-details]");
}
const databasePath = resolve(process.env.DATABASE_PATH ?? positional[0] ?? "old-guitar-bye.sqlite");
if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);
const database = new DatabaseSync(databasePath, { readOnly: true });
let listings;
try {
  listings = listListingsByMarketplace(database, "BUNJANG");
} finally {
  database.close();
}
const report = diagnoseUncertain({ listings });
if (probe) {
  report.detailProbe = await probeUncertainDetails({
    sample: report.sample,
    listings,
    client: createBunjangClient(),
    merge: mergeBunjangDetail,
  });
}
console.log(JSON.stringify(report, null, 2));
