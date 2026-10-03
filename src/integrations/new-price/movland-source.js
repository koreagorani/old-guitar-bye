import { fetchPublicHtml } from "./new-price-http.js";
import {
  absoluteUrl,
  parseKrw,
  textFromHtml,
} from "./new-price-parser-utils.js";

const SOURCE = "MOVLAND_SCHOOLMUSIC";
const BASE_URL = "https://www.movland.co.kr";

function productCardSegments(html) {
  const marker = /<td\s+width=["']?25%["']?\s+valign=["']?top["']?[^>]*>/gi;
  const matches = [...html.matchAll(marker)];
  return matches.map((match, index) => {
    const nextIndex = matches[index + 1]?.index ?? html.length;
    return html.slice(match.index, nextIndex);
  });
}

function findProductId(block) {
  return /Good_no=(\d+)/i.exec(block)?.[1] ?? null;
}

function parseSalePrice(block) {
  const prices = [...block.matchAll(/([\d,]+)\s*원/gi)]
    .map((match) => parseKrw(match[1]))
    .filter((value) => Number.isSafeInteger(value) && value >= 10000);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function parseMovlandSearchHtml(html, { observedAt } = {}) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }

  const products = [];
  const seen = new Set();

  for (const block of productCardSegments(html)) {
    const productId = findProductId(block);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);

    const titleMatch = /<font[^>]*color=["']?#393939["']?[^>]*>([\s\S]*?)<\/font>/i.exec(block);
    if (!titleMatch) continue;
    const productTitle = textFromHtml(titleMatch[1]);
    const priceKrw = parseSalePrice(block);
    const url = absoluteUrl(
      BASE_URL,
      `/Shop/index.php3?var=Good&Good_no=${productId}&version=pc`,
    );
    if (!productTitle || !url) continue;

    products.push({
      source: SOURCE,
      productTitle,
      priceKrw,
      url,
      inStock: /(?:품절|단종)/i.test(block) ? false : true,
      observedAt: observedAt ?? null,
    });
  }

  return products;
}

export function createMovlandSource({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  return {
    id: SOURCE,
    async search({ brand, observedAt }) {
      const url = new URL("/Shop/index.php3", BASE_URL);
      url.searchParams.set("var", "Search");
      url.searchParams.set("keyword", brand);
      const response = await fetchPublicHtml({
        fetchImpl,
        source: SOURCE,
        url,
        timeoutMs,
        fallbackCharset: "euc-kr",
      });
      return {
        products: parseMovlandSearchHtml(response.html, { observedAt }),
        sourceUrl: response.sourceUrl,
      };
    },
  };
}
