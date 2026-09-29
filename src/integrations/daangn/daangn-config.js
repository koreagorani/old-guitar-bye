const DEFAULT_KEYWORDS = Object.freeze([
  "기타",
  "통기타",
  "어쿠스틱 기타",
]);

function parseKeywords(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return [...DEFAULT_KEYWORDS];
  }
  const keywords = value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  if (keywords.length === 0) {
    throw new Error("DAANGN_SEARCH_KEYWORDS must contain at least one keyword");
  }
  return [...new Set(keywords)];
}

function parseLimit(value) {
  if (value === undefined || value === "") {
    return 20;
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error("DAANGN_RESULTS_PER_KEYWORD must be an integer from 1 to 100");
  }
  return limit;
}

export function loadDaangnConfig(env = process.env) {
  const region = typeof env.DAANGN_REGION === "string"
    && env.DAANGN_REGION.trim() !== ""
    ? env.DAANGN_REGION.trim()
    : null;
  return {
    keywords: parseKeywords(env.DAANGN_SEARCH_KEYWORDS),
    region,
    resultsPerKeyword: parseLimit(env.DAANGN_RESULTS_PER_KEYWORD),
  };
}

export { DEFAULT_KEYWORDS };
