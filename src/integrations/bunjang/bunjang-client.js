const BUNJANG_API_BASE_URL = "https://api.bunjang.co.kr";
const DEFAULT_USER_AGENT = "old-guitar-bye/0.1 bunjang-read-only-poc";

export class BunjangAccessError extends Error {
  constructor(message, { status = null, url = null } = {}) {
    super(message);
    this.name = "BunjangAccessError";
    this.status = status;
    this.url = url;
  }
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function assertLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new TypeError("limit must be an integer from 1 to 100");
  }
}

function looksBlocked(text) {
  const normalized = text.toLowerCase();
  return normalized.includes("captcha")
    || normalized.includes("access denied")
    || normalized.includes("비정상적인 접근");
}

async function fetchJson(fetchImpl, url, userAgent, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new BunjangAccessError(
      `Bunjang request failed before receiving a response: ${error.message}`,
      { url: String(url) },
    );
  }

  if (!response.ok) {
    throw new BunjangAccessError(
      `Bunjang request failed with HTTP ${response.status}`,
      { status: response.status, url: response.url || String(url) },
    );
  }

  const text = await response.text();
  if (looksBlocked(text)) {
    throw new BunjangAccessError("Bunjang returned an access challenge", {
      status: response.status,
      url: response.url || String(url),
    });
  }

  try {
    return {
      data: JSON.parse(text),
      sourceUrl: response.url || String(url),
    };
  } catch {
    throw new BunjangAccessError("Bunjang returned a non-JSON response", {
      status: response.status,
      url: response.url || String(url),
    });
  }
}

export function createBunjangClient({
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = 15000,
} = {}) {
  assertFetch(fetchImpl);
  assertNonEmptyString(userAgent, "userAgent");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }

  return {
    async search({ keyword, limit = 20 }) {
      assertNonEmptyString(keyword, "keyword");
      assertLimit(limit);
      const url = new URL("/api/1/find_v2.json", BUNJANG_API_BASE_URL);
      url.searchParams.set("q", keyword.trim());
      url.searchParams.set("order", "date");
      url.searchParams.set("page", "0");
      url.searchParams.set("n", String(limit));
      url.searchParams.set("stat_device", "w");
      url.searchParams.set("req_ref", "search");
      return fetchJson(fetchImpl, url, userAgent, timeoutMs);
    },

    async detail(externalListingId) {
      assertNonEmptyString(externalListingId, "externalListingId");
      const url = new URL(
        `/api/pms/v3/products-detail/${encodeURIComponent(externalListingId)}`,
        BUNJANG_API_BASE_URL,
      );
      url.searchParams.set("viewerUid", "-1");
      return fetchJson(fetchImpl, url, userAgent, timeoutMs);
    },
  };
}
