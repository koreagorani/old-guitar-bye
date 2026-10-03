export class NewPriceSourceAccessError extends Error {
  constructor(message, { source, status = null, url = null } = {}) {
    super(message);
    this.name = "NewPriceSourceAccessError";
    this.source = source;
    this.status = status;
    this.url = url;
  }
}

function charsetFrom(contentType, fallback) {
  const match = /charset=([^;\s]+)/i.exec(contentType ?? "");
  if (!match) return fallback;
  const charset = match[1].replace(/["']/g, "").toLowerCase();
  if (charset.includes("euc-kr") || charset.includes("ks_c_5601")) {
    return "euc-kr";
  }
  return charset;
}

export async function fetchPublicHtml({
  fetchImpl,
  source,
  url,
  timeoutMs,
  fallbackCharset = "utf-8",
}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "old-guitar-bye/0.1 new-price-resolver",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new NewPriceSourceAccessError(
      `${source} request failed before receiving a response: ${error.message}`,
      { source, url: String(url) },
    );
  }

  if (!response.ok) {
    throw new NewPriceSourceAccessError(
      `${source} request failed with HTTP ${response.status}`,
      { source, status: response.status, url: response.url || String(url) },
    );
  }

  const bytes = await response.arrayBuffer();
  const charset = charsetFrom(
    response.headers?.get?.("content-type"),
    fallbackCharset,
  );
  let html;
  try {
    html = new TextDecoder(charset).decode(bytes);
  } catch {
    html = new TextDecoder(fallbackCharset).decode(bytes);
  }

  if (/captcha|access denied|비정상적인 접근/i.test(html)) {
    throw new NewPriceSourceAccessError(
      `${source} returned an access challenge`,
      { source, status: response.status, url: response.url || String(url) },
    );
  }

  return {
    html,
    sourceUrl: response.url || String(url),
  };
}
