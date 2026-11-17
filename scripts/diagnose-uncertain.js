import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { diagnoseUncertain } from "../src/application/listings/diagnose-uncertain.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";
import { createBunjangClient } from "../src/integrations/bunjang/bunjang-client.js";
import { mergeBunjangDetail } from "../src/integrations/bunjang/bunjang-parser.js";
import { probeUncertainDetails } from "../src/application/listings/probe-uncertain-details.js";

const argumentsProvided = process.argv.slice(2);
let probe = false;
let probeLimit = 3;
let limitProvided = false;
const positional = [];
for (let index = 0; index < argumentsProvided.length; index += 1) {
  const arg = argumentsProvided[index];
  if (arg === "--probe-details" && !probe) {
    probe = true;
  } else if (arg === "--probe-limit" && !limitProvided) {
    limitProvided = true;
    probeLimit = Number(argumentsProvided[++index]);
  } else if (!arg.startsWith("--")) {
    positional.push(arg);
  } else {
    throw new TypeError("Unknown or repeated option: " + arg);
  }
}
if (positional.length > 1 || (limitProvided && !probe)
  || !Number.isSafeInteger(probeLimit) || probeLimit < 1 || probeLimit > 30) {
  throw new TypeError("Usage: npm run diagnose:uncertain -- [database path] [--probe-details [--probe-limit 1..30]]");
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
    limit: probeLimit,
  });
}
console.log(JSON.stringify(report, null, 2));
