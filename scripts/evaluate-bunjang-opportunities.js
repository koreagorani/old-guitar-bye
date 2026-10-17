import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateBunjangOpportunities } from "../src/application/listings/evaluate-bunjang-opportunities.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";
import { createAcousticMartSource } from "../src/integrations/new-price/acousticmart-source.js";
import { createMovlandSource } from "../src/integrations/new-price/movland-source.js";
import { createBuzzbeeSource } from "../src/integrations/new-price/buzzbee-source.js";
import { createGopherwoodSource } from "../src/integrations/new-price/gopherwood-source.js";
import { createReferenceNewPriceResolver } from "../src/integrations/new-price/reference-price-resolver.js";
import { openDatabase } from "./migrate.js";

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(value, fallback, fieldName) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${fieldName} must be a non-negative number`);
  }
  return parsed;
}

function won(value) {
  return Number(value).toLocaleString("ko-KR");
}

function formatTrack(result, index) {
  return [
    `${index + 1}. ${result.brand} ${result.model}${result.variant ? ` [${result.variant}]` : ""}`,
    `   title: ${result.title}`,
    `   used: ${won(result.askingPriceKrw)}원`,
    `   new: ${won(result.referenceNewPriceKrw)}원`,
    `   ratio: ${result.ratioPct.toFixed(2)}%`,
    `   url: ${result.url}`,
  ].join("\n");
}

const databasePath = resolve(
  process.env.DATABASE_PATH ?? process.argv[2] ?? "old-guitar-bye.sqlite",
);
const lookbackDays = parsePositiveInteger(
  process.env.OPPORTUNITY_LOOKBACK_DAYS,
  30,
  "OPPORTUNITY_LOOKBACK_DAYS",
);
const thresholdPct = parseNonNegativeNumber(
  process.env.OPPORTUNITY_THRESHOLD_PCT,
  12,
  "OPPORTUNITY_THRESHOLD_PCT",
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
  const evaluation = await evaluateBunjangOpportunities({
    listings,
    resolver,
    lookbackDays,
    thresholdPct,
  });

  console.log("SUMMARY");
  console.log(JSON.stringify(evaluation.summary, null, 2));
  console.log("");

  console.log("TRACK");
  if (evaluation.track.length === 0) {
    console.log("(none)");
  } else {
    console.log(evaluation.track.map(formatTrack).join("\n\n"));
  }

  console.log("");
  console.log(
    `IGNORE: ${evaluation.summary.ignore} | `
    + `UNRESOLVED_REFERENCE: ${evaluation.summary.referenceUnresolved} | `
    + `UNRESOLVED_IDENTITY: ${evaluation.summary.identityUnresolved}`,
  );
  console.log("");
  console.log("JSON");
  console.log(JSON.stringify({
    databasePath,
    marketplace: "BUNJANG",
    ...evaluation,
  }, null, 2));
} finally {
  database.close();
}
