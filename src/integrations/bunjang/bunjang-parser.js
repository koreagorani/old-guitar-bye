const BUNJANG_WEB_BASE_URL = "https://m.bunjang.co.kr";

const SEARCH_STATUS = Object.freeze({
  "0": "SELLING",
  "1": "RESERVED",
  "3": "SOLD_OUT",
});

function parseInteger(value) {
  if (Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function normalizePostedAt(value) {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStatus(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const key = String(value);
  return SEARCH_STATUS[key] ?? key;
}

function searchItems(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  return Array.isArray(payload.list) ? payload.list : [];
}

export function normalizeBunjangSearchItem(raw, {
  keyword,
  discoveredAt,
  sourceUrl,
} = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const externalListingId = raw.pid !== null && raw.pid !== undefined
    ? String(raw.pid).trim()
    : "";
  const title = normalizeText(raw.name);
  if (externalListingId === "" || !/^\d+$/.test(externalListingId) || !title) {
    return null;
  }
  if (raw.ad === true) {
    return null;
  }

  return {
    marketplace: "BUNJANG",
    externalListingId,
    title,
    priceKrw: parseInteger(raw.price),
    url: `${BUNJANG_WEB_BASE_URL}/products/${encodeURIComponent(externalListingId)}`,
    locationText: normalizeText(raw.location),
    sellerName: null,
    postedAt: normalizePostedAt(raw.update_time),
    status: normalizeStatus(raw.status),
    discoveredAt: discoveredAt ?? null,
    description: "",
    sourceMetadata: {
      keyword: keyword ?? null,
      sourceUrl: sourceUrl ?? null,
      rawStatus: raw.status ?? null,
      used: raw.used ?? null,
      freeShipping: raw.free_shipping ?? null,
    },
  };
}

export function parseBunjangSearchPayload(payload, context = {}) {
  return searchItems(payload)
    .map((raw) => normalizeBunjangSearchItem(raw, context))
    .filter(Boolean);
}

export function mergeBunjangDetail(candidate, payload) {
  if (candidate === null || typeof candidate !== "object") {
    throw new TypeError("candidate must be an object");
  }
  const data = payload?.data;
  const product = data && typeof data === "object" ? data.product : null;
  const shop = data && typeof data === "object" ? data.shop : null;

  if (!product || typeof product !== "object") {
    return { ...candidate };
  }

  const productId = product.pid ?? product.id;
  if (productId !== null
    && productId !== undefined
    && String(productId) !== candidate.externalListingId) {
    throw new Error(
      `Bunjang detail id mismatch: ${String(productId)} != ${candidate.externalListingId}`,
    );
  }

  const priceKrw = parseInteger(product.price);
  const geo = product.geo && typeof product.geo === "object" ? product.geo : null;
  const locationText = normalizeText(product.geoLabel)
    ?? normalizeText(geo?.address)
    ?? candidate.locationText;
  const sellerName = normalizeText(shop?.name) ?? candidate.sellerName;
  const description = normalizeText(product.description) ?? candidate.description;

  return {
    ...candidate,
    title: normalizeText(product.name) ?? candidate.title,
    priceKrw: priceKrw ?? candidate.priceKrw,
    locationText,
    sellerName,
    status: normalizeText(product.saleStatus) ?? candidate.status,
    description,
    sourceMetadata: {
      ...candidate.sourceMetadata,
      condition: product.condition ?? null,
      detailLoaded: true,
    },
  };
}

export function toListingRecord(candidate, { lastSeenAt } = {}) {
  if (candidate === null || typeof candidate !== "object") {
    throw new TypeError("candidate must be an object");
  }

  const missing = [];
  if (!Number.isSafeInteger(candidate.priceKrw) || candidate.priceKrw < 0) {
    missing.push("priceKrw");
  }
  if (typeof candidate.locationText !== "string"
    || candidate.locationText.trim() === "") {
    missing.push("locationText");
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
