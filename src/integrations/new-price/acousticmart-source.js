import { fetchPublicHtml } from "./new-price-http.js";
import {
  absoluteUrl,
  parseKrw,
  textFromHtml,
} from "./new-price-parser-utils.js";

const SOURCE = "ACOUSTICMART";
const BASE_URL = "https://www.acousticmart.co.kr";

function parseSalePrice(block) {
  const direct = /판매가<\/span>\s*:\s*<\/strong>\s*<span[^>]*>([\d,]+)\s*원/i.exec(block);
  if (direct) return parseKrw(direct[1]);

  const prices = [...block.matchAll(/([\d,]+)\s*원/g)]
    .map((match) => parseKrw(match[1]))
    .filter((value) => Number.isSafeInteger(value) && value >= 10000);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function parseAcousticMartSearchHtml(html, { observedAt } = {}) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }

  const matches = [...html.matchAll(/<p class="name">([\s\S]*?)<\/p>/gi)];
  const products = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nameHtml = match[1];
    const link = /<a href="([^"]*\/product\/detail\.html\?[^"]*product_no=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(nameHtml);
    if (!link) continue;

    const nextIndex = matches[index + 1]?.index ?? html.length;
    const block = html.slice(match.index, nextIndex);
    const productTitle = textFromHtml(link[3]);
    const priceKrw = parseSalePrice(block);
    const url = absoluteUrl(BASE_URL, link[1]);
    if (!productTitle || !url) continue;

    products.push({
      source: SOURCE,
      productTitle,
      priceKrw,
      url,
      inStock: /(?:품절|sold\s*out)/i.test(block) ? false : true,
      observedAt: observedAt ?? null,
    });
  }

  return products;
}

export function createAcousticMartSource({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  return {
    id: SOURCE,
    async search({ brand, observedAt }) {
      const url = new URL("/product/search.html", BASE_URL);
      url.searchParams.set("keyword", brand);
      const response = await fetchPublicHtml({
        fetchImpl,
        source: SOURCE,
        url,
        timeoutMs,
      });
      return {
        products: parseAcousticMartSearchHtml(response.html, { observedAt }),
        sourceUrl: response.sourceUrl,
      };
    },
  };
}
