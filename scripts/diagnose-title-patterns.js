import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { diagnoseTitlePatterns } from "../src/application/listings/diagnose-title-patterns.js";
import { listListingsByMarketplace } from "../src/repositories/listing-repository.js";

// Frozen immediately before the relevance change; never fetched over the network.
const BASELINE_SHA = "eb42f85d20232d03cc852a89ab820f74a85cf628";
const IDENTITY_BASELINE_SHA = "120998c20dd9d598221f0cd0a887252f06291f69";
const args = process.argv.slice(2);
const compareBaseline = args.includes("--compare-baseline");
const compareIdentityBaseline = args.includes("--compare-identity-baseline");
const positional = args.filter((arg) =>
  arg !== "--compare-baseline" && arg !== "--compare-identity-baseline");
if (compareBaseline && compareIdentityBaseline
  || positional.length > 1 || positional.some((arg) => arg.startsWith("--"))) {
  throw new TypeError("Usage: npm run diagnose:title-patterns -- [database path] [--compare-baseline | --compare-identity-baseline]");
}
const databasePath = resolve(process.env.DATABASE_PATH ?? positional[0] ?? "old-guitar-bye.sqlite");
if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);

function readBaselineSource(sha, path) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  try {
    return execFileSync("git", ["show", `${sha}:${path}`], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`Local git history lacks baseline ${sha}; fetch that commit before comparing`);
  }
}

async function loadBaselineModule(sha, path) {
  let source = readBaselineSource(sha, path);
  const importLine = 'from "./guitar-brand-aliases.js";';
  if (!source.includes(importLine)) throw new Error("Baseline classifier import layout changed");
  source = source.replace(importLine,
    `from "${new URL("../src/domain/listing/guitar-brand-aliases.js", import.meta.url).href}";`);
  const modelImport = 'from "./guitar-model-patterns.js";';
  if (source.includes(modelImport)) {
    const modelSource = readBaselineSource(sha, "src/domain/listing/guitar-model-patterns.js");
    source = source.replace(modelImport,
      `from "data:text/javascript;base64,${Buffer.from(modelSource).toString("base64")}";`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const baselineSha = compareIdentityBaseline ? IDENTITY_BASELINE_SHA
  : compareBaseline ? BASELINE_SHA : null;
const baselineClassify = baselineSha
  ? (await loadBaselineModule(baselineSha,
    "src/domain/listing/listing-relevance.js")).classifyListingRelevance : null;
const baselineNormalize = compareIdentityBaseline
  ? (await loadBaselineModule(baselineSha,
    "src/domain/listing/guitar-identity.js")).normalizeGuitarIdentity : undefined;
const database = new DatabaseSync(databasePath, { readOnly: true });
let listings;
try {
  listings = listListingsByMarketplace(database, "BUNJANG");
} finally {
  database.close();
}
console.log(JSON.stringify({
  marketplace: "BUNJANG",
  baselineSha,
  ...diagnoseTitlePatterns({ listings, baselineClassify, baselineNormalize }),
}, null, 2));
