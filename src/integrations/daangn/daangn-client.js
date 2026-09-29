const DAANGN_BASE_URL = "https://www.daangn.com";
const DEFAULT_USER_AGENT = "old-guitar-bye/0.1 daangn-read-only-poc";

export class DaangnAccessError extends Error {
  constructor(message, { status = null, url = null } = {}) {
    super(message);
    this.name = "DaangnAccessError";
    this.status = status;
    this.url = url;
  }
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function headers(userAgent, accept) {
  return {
    Accept: accept,
    "User-Agent": userAgent,
  };
}

function looksBlocked(text) {
  const normalized = text.toLowerCase();
  return normalized.includes("captcha")
    || normalized.includes("비정상적인 접근")
    || normalized.includes("access denied");
}

async function fetchText(fetchImpl, url, userAgent, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: headers(userAgent, "text/html,application/xhtml+xml"),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new DaangnAccessError(
      `Daangn request failed before receiving a response: ${error.message}`,
      { url: String(url) },
    );
  }
  if (!response.ok) {
    throw new DaangnAccessError(
      `Daangn request failed with HTTP ${response.status}`,
      { status: response.status, url: response.url || String(url) },
    );
  }
  const text = await response.text();
  if (looksBlocked(text)) {
    throw new DaangnAccessError("Daangn returned an access challenge", {
      status: response.status,
      url: response.url || String(url),
    });
  }
  return { text, url: response.url || String(url) };
}

async function fetchJson(fetchImpl, url, userAgent, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: headers(userAgent, "application/json"),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new DaangnAccessError(
      `Daangn request failed before receiving a response: ${error.message}`,
      { url: String(url) },
    );
  }
  if (!response.ok) {
    throw new DaangnAccessError(
      `Daangn request failed with HTTP ${response.status}`,
      { status: response.status, url: response.url || String(url) },
    );
  }
  try {
    return { data: await response.json(), url: response.url || String(url) };
  } catch {
    throw new DaangnAccessError("Daangn returned a non-JSON region response", {
      status: response.status,
      url: response.url || String(url),
    });
  }
}

function chooseRegion(locations, requestedRegion) {
  if (!Array.isArray(locations) || locations.length === 0) {
    return null;
  }
  const exact = locations.find((location) => [
    location?.name,
    location?.name1,
    location?.name2,
    location?.name3,
  ].includes(requestedRegion));
  return exact ?? locations[0];
}

export function createDaangnClient({
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
    async resolveRegion(regionName) {
      assertNonEmptyString(regionName, "regionName");
      const url = new URL("/kr/api/v1/regions/keyword", DAANGN_BASE_URL);
      url.searchParams.set("keyword", regionName.trim());
      const { data, url: sourceUrl } = await fetchJson(
        fetchImpl,
        url,
        userAgent,
        timeoutMs,
      );
      const selected = chooseRegion(data?.locations, regionName.trim());
      if (!selected) {
        return null;
      }
      const id = selected.id ?? selected.dbId;
      if (id === undefined || typeof selected.name !== "string") {
        return null;
      }
      return {
        id: String(id),
        name: selected.name,
        fullName: [selected.name1, selected.name2, selected.name3]
          .filter(Boolean)
          .join(" ") || selected.name,
        slug: `${selected.name}-${id}`,
        sourceUrl,
      };
    },

    async search({ keyword, regionSlug = null }) {
      assertNonEmptyString(keyword, "keyword");
      const url = new URL(
        regionSlug ? "/kr/buy-sell/all/" : "/kr/buy-sell/",
        DAANGN_BASE_URL,
      );
      url.searchParams.set("search", keyword.trim());
      url.searchParams.set("only_on_sale", "true");
      if (regionSlug !== null) {
        assertNonEmptyString(regionSlug, "regionSlug");
        url.searchParams.set("in", regionSlug.trim());
      }
      const { text: html, url: sourceUrl } = await fetchText(
        fetchImpl,
        url,
        userAgent,
        timeoutMs,
      );
      return { html, sourceUrl };
    },
  };
}
