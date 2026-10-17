const requests = [
  {
    name: "LEGACY_SEARCH",
    url: "https://api.bunjang.co.kr/api/1/find_v2.json?q=%ED%86%B5%EA%B8%B0%ED%83%80&order=date&page=0&n=5&stat_device=w&req_ref=search",
    accept: "application/json",
  },
  {
    name: "SEARCH_V8_LATEST",
    url: "https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword?q=%ED%86%B5%EA%B8%B0%ED%83%80&sort=latest",
    accept: "application/json",
  },
  {
    name: "SEARCH_V8_SCORE",
    url: "https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword?q=%ED%86%B5%EA%B8%B0%ED%83%80&sort=score",
    accept: "application/json",
  },
  {
    name: "PUBLIC_SEARCH_HTML",
    url: "https://m.bunjang.co.kr/keywords/%ED%86%B5%EA%B8%B0%ED%83%80",
    accept: "text/html,application/xhtml+xml",
  },
];

function shape(value, depth = 0) {
  if (depth > 3) return typeof value;
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 2).map((item) => shape(item, depth + 1)),
    };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, item]) => [key, shape(item, depth + 1)]),
    );
  }
  return typeof value;
}

function productLikeSamples(value, path = "$", out = []) {
  if (out.length >= 8 || value == null) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && out.length < 8; i += 1) {
      productLikeSamples(value[i], `${path}[${i}]`, out);
    }
    return out;
  }
  if (typeof value !== "object") return out;

  const keys = Object.keys(value);
  const hasId = keys.some((key) => /^(pid|id|productId|product_id)$/i.test(key));
  const hasTitle = keys.some((key) => /^(name|title|productName|product_name)$/i.test(key));
  const hasPrice = keys.some((key) => /price/i.test(key));
  if (hasId && hasTitle && hasPrice) {
    out.push({
      path,
      value: Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => /id|pid|name|title|price|status|location|region|date|time|url|seller|shop/i.test(key))
          .slice(0, 35),
      ),
    });
  }

  for (const [key, item] of Object.entries(value)) {
    if (out.length >= 8) break;
    productLikeSamples(item, `${path}.${key}`, out);
  }
  return out;
}

function htmlSignals(html) {
  const markers = [
    "__NEXT_DATA__",
    "__next_f.push",
    "api/search/v8",
    "find_v2",
    "products/",
    "통기타",
    "productId",
    "price",
  ];
  const snippets = {};
  for (const marker of markers) {
    const index = html.indexOf(marker);
    snippets[marker] = index < 0
      ? null
      : html.slice(Math.max(0, index - 800), Math.min(html.length, index + 1800));
  }
  return {
    length: html.length,
    markers: Object.fromEntries(markers.map((marker) => [marker, html.includes(marker)])),
    snippets,
  };
}

for (const request of requests) {
  try {
    const response = await fetch(request.url, {
      method: "GET",
      headers: {
        Accept: request.accept,
        "User-Agent": "old-guitar-bye/0.1 bunjang-current-structure-poc",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type");
    let parsed = null;
    if (/json/i.test(contentType ?? "") || /^[\s]*[{[]/.test(text)) {
      try { parsed = JSON.parse(text); } catch {}
    }

    console.log("BUNJANG_CURRENT_CAPTURE=" + JSON.stringify({
      name: request.name,
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      contentType,
      textLength: text.length,
      jsonShape: parsed ? shape(parsed) : null,
      productLikeSamples: parsed ? productLikeSamples(parsed) : [],
      htmlSignals: request.name === "PUBLIC_SEARCH_HTML" ? htmlSignals(text) : null,
      textPreview: text.slice(0, 2500),
    }));
  } catch (error) {
    console.log("BUNJANG_CURRENT_CAPTURE=" + JSON.stringify({
      name: request.name,
      success: false,
      errorName: error?.name ?? "Error",
      message: error?.message ?? String(error),
    }));
  }
}
