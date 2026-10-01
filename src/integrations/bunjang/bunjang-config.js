const DEFAULT_KEYWORDS = Object.freeze([
  "기타",
  "통기타",
  "어쿠스틱 기타",
]);

function parseKeywords(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return [...DEFAULT_KEYWORDS];
  }
  const keywords = [...new Set(
    value.split(",").map((item) => item.trim()).filter(Boolean),
  )];
  if (keywords.length === 0) {
    throw new Error("BUNJANG_SEARCH_KEYWORDS must contain at least one keyword");
  }
  return keywords;
}

function parseLimit(value) {
  if (value === undefined || value === "") {
    return 20;
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error("BUNJANG_RESULTS_PER_KEYWORD must be an integer from 1 to 100");
  }
  return limit;
}

function parseBoolean(value) {
  return value === "1" || value === "true";
}

export function loadBunjangConfig(env = process.env) {
  return {
    keywords: parseKeywords(env.BUNJANG_SEARCH_KEYWORDS),
    resultsPerKeyword: parseLimit(env.BUNJANG_RESULTS_PER_KEYWORD),
    enrichDetails: parseBoolean(env.BUNJANG_ENRICH_DETAILS),
  };
}

export { DEFAULT_KEYWORDS };
