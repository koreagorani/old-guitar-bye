import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { diagnoseTitlePatterns } from "../src/application/listings/diagnose-title-patterns.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";

// Frozen immediately before the relevance change; never fetched over the network.
const BASELINE_SHA = "eb42f85d20232d03cc852a89ab820f74a85cf628";
const args = process.argv.slice(2);
const compareBaseline = args.includes("--compare-baseline");
const positional = args.filter((arg) => arg !== "--compare-baseline");
if (positional.length > 1 || positional.some((arg) => arg.startsWith("--"))) {
  throw new TypeError("Usage: npm run diagnose:title-patterns -- [database path] [--compare-baseline]");
}
const databasePath = resolve(process.env.DATABASE_PATH ?? positional[0] ?? "old-guitar-bye.sqlite");
if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);

async function loadBaselineClassifier() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let source;
  try {
    source = execFileSync("git", ["show", `${BASELINE_SHA}:src/domain/listing/listing-relevance.js`], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`Local git history lacks baseline ${BASELINE_SHA}; fetch that commit before comparing`);
  }
  const importLine = 'from "./guitar-brand-aliases.js";';
  if (!source.includes(importLine)) throw new Error("Baseline classifier import layout changed");
  source = source.replace(importLine,
    `from "${new URL("../src/domain/listing/guitar-brand-aliases.js", import.meta.url).href}";`);
  const baseline = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  return baseline.classifyListingRelevance;
}

const baselineClassify = compareBaseline ? await loadBaselineClassifier() : null;
const database = new DatabaseSync(databasePath, { readOnly: true });
let listings;
try {
  listings = listListingsByMarketplace(database, "BUNJANG");
} finally {
  database.close();
}
console.log(JSON.stringify({
  marketplace: "BUNJANG",
  baselineSha: compareBaseline ? BASELINE_SHA : null,
  ...diagnoseTitlePatterns({ listings, baselineClassify }),
}, null, 2));
