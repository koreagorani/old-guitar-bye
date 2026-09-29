const url = new URL("https://www.daangn.com/kr/search/buy-sell/");
url.searchParams.set("q", "통기타");
url.searchParams.set("only_on_sale", "true");
url.searchParams.set("in", "역삼동-6035");

const response = await fetch(url, {
  method: "GET",
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "User-Agent": "old-guitar-bye/0.1 daangn-read-only-poc",
  },
  redirect: "follow",
  signal: AbortSignal.timeout(15000),
});
const html = await response.text();

function extractBalancedObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const json = extractBalancedObject(html, "window.__remixContext =");
const context = json ? JSON.parse(json) : null;
const loaderData = context?.state?.loaderData ?? {};

const arrays = [];
const listingLike = [];
const seen = new Set();

function walk(value, path, depth = 0) {
  if (depth > 10 || value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    arrays.push({
      path,
      length: value.length,
      firstType: value.length === 0 ? null : typeof value[0],
      firstKeys: value[0] && typeof value[0] === "object" && !Array.isArray(value[0])
        ? Object.keys(value[0]).slice(0, 30)
        : [],
    });
    const firstObject = value.find(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
    if (firstObject) {
      const keys = Object.keys(firstObject);
      if (keys.some((key) => [
        "title","price","href","id","status","createdAt","region","webUrl","url",
      ].includes(key))) {
        listingLike.push({
          path,
          length: value.length,
          sample: value.slice(0, 3),
        });
      }
    }
    for (let i = 0; i < Math.min(value.length, 3); i += 1) {
      walk(value[i], `${path}[${i}]`, depth + 1);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    walk(child, path ? `${path}.${key}` : key, depth + 1);
  }
}

walk(loaderData, "loaderData");

console.log("DAANGN_STRUCTURE=" + JSON.stringify({
  status: response.status,
  finalUrl: response.url,
  loaderDataKeys: Object.keys(loaderData),
  buySellRouteSummaries: Object.fromEntries(
    Object.entries(loaderData)
      .filter(([key]) => key.includes("buy-sell"))
      .map(([key, value]) => [key, {
        type: Array.isArray(value) ? "array" : typeof value,
        keys: value && typeof value === "object" && !Array.isArray(value)
          ? Object.keys(value)
          : [],
      }]),
  ),
  arrays: arrays.slice(0, 80),
  listingLike: listingLike.slice(0, 12),
}));
