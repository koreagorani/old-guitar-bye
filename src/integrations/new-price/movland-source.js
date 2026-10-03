import { fetchPublicHtml } from "./new-price-http.js";
import {
  absoluteUrl,
  parseKrw,
  textFromHtml,
} from "./new-price-parser-utils.js";

const SOURCE = "MOVLAND_SCHOOLMUSIC";
const BASE_URL = "https://www.movland.co.kr";

function productTitleMatches(html) {
  return [...html.matchAll(/<font[^>]*color=["']?#393939["']?[^>]*>([\s\S]*?)<\/font>/gi)];
}

function findProductId(before) {
  const ids = [...before.matchAll(/Good_no=(\d+)/gi)];
  return ids.at(-1)?.[1] ?? null;
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

  const matches = productTitleMatches(html);
  const products = [];
  const seen = new Set();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const before = html.slice(Math.max(0, match.index - 5000), match.index);
    const productId = findProductId(before);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);

    const nextIndex = matches[index + 1]?.index ?? Math.min(html.length, match.index + 7000);
    const block = html.slice(match.index, nextIndex);
    const productTitle = textFromHtml(match[1]);
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
