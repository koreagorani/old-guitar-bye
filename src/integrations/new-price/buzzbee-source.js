import { fetchPublicHtml } from "./new-price-http.js";
import {
  absoluteUrl,
  parseKrw,
  textFromHtml,
} from "./new-price-parser-utils.js";

const SOURCE = "BUZZBEE";
const BASE_URL = "https://www.buzzbee.co.kr";

function productCards(html) {
  const links = [...html.matchAll(
    /href=["']([^"']*goods\/goods_view\.php\?goodsNo=(\d+)[^"']*)["']/gi,
  )];
  const firstById = new Map();
  for (const match of links) {
    if (!firstById.has(match[2])) {
      firstById.set(match[2], match);
    }
  }

  const matches = [...firstById.values()].sort((a, b) => a.index - b.index);
  return matches.map((match, index) => {
    const start = html.lastIndexOf("<li", match.index);
    const nextIndex = matches[index + 1]?.index ?? html.length;
    const end = html.indexOf("</li>", match.index);
    return {
      goodsNo: match[2],
      href: match[1],
      block: html.slice(
        start >= 0 ? start : match.index,
        end >= 0 && end < nextIndex ? end + 5 : nextIndex,
      ),
    };
  });
}

function parseVisibleSalePrice(block) {
  const direct = /<strong[^>]*class=["'][^"']*salePrice[^"']*["'][^>]*>[\s\S]*?<span[^>]*>\s*([\d,]+)\s*원/i.exec(block);
  if (direct) {
    return parseKrw(direct[1]);
  }

  const fallback = /data-goods-price=["']([\d,.]+)["']/i.exec(block);
  return fallback ? parseKrw(fallback[1]) : null;
}

export function parseBuzzbeeSearchHtml(html, { observedAt } = {}) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }

  const products = [];
  for (const card of productCards(html)) {
    const titleMatch = /<strong[^>]*class=["'][^"']*item_name[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i.exec(card.block);
    if (!titleMatch) continue;

    const productTitle = textFromHtml(titleMatch[1]);
    const priceKrw = parseVisibleSalePrice(card.block);
    const url = absoluteUrl(BASE_URL, card.href);
    if (!productTitle || !url) continue;

    products.push({
      source: SOURCE,
      productTitle,
      priceKrw,
      url,
      inStock: /(?:품절|sold\s*out|item_soldout)/i.test(card.block)
        ? false
        : true,
      observedAt: observedAt ?? null,
    });
  }

  return products;
}

export function createBuzzbeeSource({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  return {
    id: SOURCE,
    async search({ brand, observedAt }) {
      const url = new URL("/goods/goods_search.php", BASE_URL);
      url.searchParams.set("keyword", brand);
      const response = await fetchPublicHtml({
        fetchImpl,
        source: SOURCE,
        url,
        timeoutMs,
      });
      return {
        products: parseBuzzbeeSearchHtml(response.html, { observedAt }),
        sourceUrl: response.sourceUrl,
      };
    },
  };
}
