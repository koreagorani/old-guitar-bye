import { fetchPublicHtml } from "./new-price-http.js";
import {
  absoluteUrl,
  parseKrw,
  textFromHtml,
} from "./new-price-parser-utils.js";

const SOURCE = "GOPHERWOOD_OFFICIAL";
const BASE_URL = "https://www.gopherwood.co.kr";

function productBlocks(html) {
  const markers = [...html.matchAll(
    /<div[^>]+id=["']anchorBoxId_(\d+)["'][^>]*>/gi,
  )];
  return markers.map((match, index) => {
    const nextIndex = markers[index + 1]?.index ?? html.length;
    return html.slice(match.index, nextIndex);
  });
}

function parseVisibleSalePrice(block) {
  const labelIndex = block.search(/판매가/i);
  if (labelIndex < 0) return null;
  const tail = block.slice(labelIndex, labelIndex + 1400);
  const match = /([\d,]+)\s*원/i.exec(textFromHtml(tail));
  if (match) return parseKrw(match[1]);

  const raw = /([\d,]+(?:\.\d+)?)\s*(?:원|KRW)?/i.exec(tail);
  return raw ? parseKrw(raw[1]) : null;
}

export function parseGopherwoodSearchHtml(html, { observedAt } = {}) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }

  const products = [];
  for (const block of productBlocks(html)) {
    const nameBlock = /<div[^>]*class=["'][^"']*prd_name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1];
    if (!nameBlock) continue;
    const link = /<a[^>]+href=["']([^"']*\/product\/[^"']+)["'][^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i.exec(nameBlock);
    if (!link) continue;

    const productTitle = textFromHtml(link[2]);
    const url = absoluteUrl(BASE_URL, link[1]);
    const priceKrw = parseVisibleSalePrice(block);
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

export function createGopherwoodSource({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  return {
    id: SOURCE,
    cacheByModel: true,
    async search({ brand, model, observedAt }) {
      if (brand !== "GOPHERWOOD") {
        return { products: [], sourceUrl: null };
      }

      const url = new URL("/product/search.html", BASE_URL);
      url.searchParams.set("keyword", model);
      const response = await fetchPublicHtml({
        fetchImpl,
        source: SOURCE,
        url,
        timeoutMs,
      });
      return {
        products: parseGopherwoodSearchHtml(response.html, { observedAt }),
        sourceUrl: response.sourceUrl,
      };
    },
  };
}
