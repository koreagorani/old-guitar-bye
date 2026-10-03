const DAANGN_BASE_URL = "https://www.daangn.com";

function extractBalancedJson(source, marker, openCharacter) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const start = source.indexOf(openCharacter, markerIndex + marker.length);
  if (start < 0) {
    return null;
  }
  const closeCharacter = openCharacter === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === openCharacter) {
      depth += 1;
    } else if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  return null;
}

function remixLoaderData(html) {
  const markers = [
    "window.__remixContext =",
    "window.__remixContext=",
  ];

  for (const marker of markers) {
    const json = extractBalancedJson(html, marker, "{");
    if (!json) {
      continue;
    }
    try {
      const context = JSON.parse(json);
      const loaderData = context?.state?.loaderData;
      if (loaderData && typeof loaderData === "object") {
        return loaderData;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function remixLoaderArticles(html) {
  const loaderData = remixLoaderData(html);
  if (!loaderData) {
    return [];
  }

  const articles = [];
  for (const [routeKey, routeValue] of Object.entries(loaderData)) {
    if (!routeKey.includes("buy-sell")
      || routeValue === null
      || typeof routeValue !== "object") {
      continue;
    }

    if (Array.isArray(routeValue.buySellArticles)) {
      articles.push(...routeValue.buySellArticles);
      continue;
    }

    if (Array.isArray(routeValue.allPage?.fleamarketArticles)) {
      articles.push(...routeValue.allPage.fleamarketArticles);
    }
  }
  return articles;
}

function embeddedArticles(html) {
  for (const marker of ['"fleamarketArticles":', '\\"fleamarketArticles\\":']) {
    const json = extractBalancedJson(html, marker, "[");
    if (!json) {
      continue;
    }
    try {
      const parsed = JSON.parse(
        marker.startsWith("\\") ? json.replace(/\\\"/g, '"') : json,
      );
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return [];
}

function ldItemListArticles(html) {
  const articles = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const data = JSON.parse(match[1]);
      if (data?.["@type"] !== "ItemList" || !Array.isArray(data.itemListElement)) {
        continue;
      }
      for (const entry of data.itemListElement) {
        const item = entry?.item;
        if (!item || typeof item !== "object") {
          continue;
        }
        articles.push({
          title: item.name,
          price: item.offers?.price,
          href: item.url,
          content: item.description,
          user: item.offers?.seller
            ? { nickname: item.offers.seller.name }
            : undefined,
        });
      }
    } catch {
      continue;
    }
  }
  return articles;
}

function absoluteUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  try {
    return new URL(value, DAANGN_BASE_URL).toString();
  } catch {
    return null;
  }
}

export function extractDaangnExternalListingId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const trimmed = value.trim();
  if (/^[a-z0-9]+$/i.test(trimmed)) {
    return trimmed;
  }
  const slugMatch = trimmed.match(/-([a-z0-9]+)\/?(?:\?.*)?$/i);
  if (slugMatch) {
    return slugMatch[1];
  }
  const pathMatch = trimmed.match(/\/buy-sell\/([a-z0-9]+)\/?(?:\?.*)?$/i);
  return pathMatch?.[1] ?? null;
}

function parsePrice(raw) {
  if (Number.isSafeInteger(raw) && raw >= 0) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  if (value === "") {
    return null;
  }
  if (value.includes("나눔") || value === "무료") {
    return 0;
  }
  const digits = value.replace(/[^0-9]/g, "");
  if (digits === "") {
    return null;
  }
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function locationText(raw) {
  const direct = [raw.locationName, raw.locationText, raw.region?.name]
    .find((value) => typeof value === "string" && value.trim() !== "");
  if (direct) {
    return direct.trim();
  }
  const path = [raw.region?.name1, raw.region?.name2, raw.region?.name3]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join(" ");
  return path || null;
}

function sellerName(raw) {
  const value = raw.user?.nickname ?? raw.seller?.nickname ?? raw.sellerName;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function normalizeDaangnArticle(raw, {
  keyword,
  discoveredAt,
  sourceUrl,
} = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const url = absoluteUrl(raw.href ?? raw.webUrl ?? raw.url);
  const externalListingId = extractDaangnExternalListingId(
    raw.id ? String(raw.id) : url ?? "",
  );
  if (title === "" || !url || !externalListingId) {
    return null;
  }

  return {
    marketplace: "DAANGN",
    externalListingId,
    title,
    priceKrw: parsePrice(raw.price ?? raw.priceText ?? raw.price_text),
    url,
    locationText: locationText(raw),
    sellerName: sellerName(raw),
    status: typeof raw.status === "string" ? raw.status : null,
    postedAt: typeof raw.createdAt === "string"
      ? raw.createdAt
      : typeof raw.postedAt === "string"
        ? raw.postedAt
        : null,
    discoveredAt: discoveredAt ?? null,
    description: typeof raw.content === "string" ? raw.content : "",
    sourceMetadata: {
      keyword: keyword ?? null,
      status: raw.status ?? null,
      categoryName: raw.category?.name ?? null,
      sourceUrl: sourceUrl ?? null,
    },
  };
}

export function parseDaangnSearchHtml(html, context = {}) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }
  const liveArticles = remixLoaderArticles(html);
  const legacyArticles = liveArticles.length > 0
    ? liveArticles
    : embeddedArticles(html);
  const fallbackArticles = legacyArticles.length > 0
    ? legacyArticles
    : ldItemListArticles(html);
  return fallbackArticles
    .map((raw) => normalizeDaangnArticle(raw, context))
    .filter(Boolean);
}

export function toListingRecord(candidate, { lastSeenAt } = {}) {
  if (candidate === null || typeof candidate !== "object") {
    throw new TypeError("candidate must be an object");
  }
  const missing = [];
  if (!Number.isSafeInteger(candidate.priceKrw) || candidate.priceKrw < 0) {
    missing.push("priceKrw");
  }
  if (typeof candidate.discoveredAt !== "string"
    || candidate.discoveredAt.trim() === "") {
    missing.push("discoveredAt");
  }
  if (missing.length > 0) {
    return { listing: null, missing };
  }
  return {
    listing: {
      marketplace: candidate.marketplace,
      externalListingId: candidate.externalListingId,
      url: candidate.url,
      title: candidate.title,
      description: candidate.description ?? "",
      askingPriceKrw: candidate.priceKrw,
      sellerLocationText: candidate.locationText,
      discoveredAt: candidate.discoveredAt,
      lastSeenAt: lastSeenAt ?? candidate.discoveredAt,
    },
    missing: [],
  };
}


export function inspectDaangnSearchHtml(html) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }

  const loaderData = remixLoaderData(html);
  if (!loaderData) {
    return {
      remixContextFound: false,
      routeKey: null,
      articleContainerFound: false,
      articleCount: null,
      productAdsCount: null,
    };
  }

  for (const [routeKey, routeValue] of Object.entries(loaderData)) {
    if (!routeKey.includes("buy-sell")
      || routeValue === null
      || typeof routeValue !== "object") {
      continue;
    }

    const currentArticles = routeValue.buySellArticles;
    const legacyArticles = routeValue.allPage?.fleamarketArticles;
    const articles = Array.isArray(currentArticles)
      ? currentArticles
      : Array.isArray(legacyArticles)
        ? legacyArticles
        : null;
    const productAds = Array.isArray(routeValue.productAds)
      ? routeValue.productAds
      : null;

    return {
      remixContextFound: true,
      routeKey,
      articleContainerFound: articles !== null,
      articleCount: articles?.length ?? null,
      productAdsCount: productAds?.length ?? null,
    };
  }

  return {
    remixContextFound: true,
    routeKey: null,
    articleContainerFound: false,
    articleCount: null,
    productAdsCount: null,
  };
}
