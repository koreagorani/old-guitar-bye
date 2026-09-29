const url = new URL("https://www.daangn.com/kr/buy-sell/");
url.searchParams.set("search", "통기타");
url.searchParams.set("only_on_sale", "true");

const response = await fetch(url, {
  method: "GET",
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "User-Agent": "old-guitar-bye/0.1 daangn-read-only-poc",
  },
  redirect: "follow",
  signal: AbortSignal.timeout(15000),
});

const html = await response.text();

function around(marker, radius = 900) {
  const index = html.indexOf(marker);
  if (index < 0) return null;
  return html.slice(Math.max(0, index - radius), Math.min(html.length, index + marker.length + radius));
}

const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .map((match, index) => {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const type = /type=["']([^"']+)["']/i.exec(attrs)?.[1] ?? null;
    const id = /id=["']([^"']+)["']/i.exec(attrs)?.[1] ?? null;
    const src = /src=["']([^"']+)["']/i.exec(attrs)?.[1] ?? null;
    const interesting = /buy-sell|fleamarket|remix|loaderData|__next|search|article|product/i.test(body);
    return {
      index,
      type,
      id,
      src,
      length: body.length,
      interesting,
      preview: interesting ? body.slice(0, 1600) : null,
    };
  });

const hrefs = [...html.matchAll(/href=["']([^"']*\/kr\/buy-sell\/[^"']+)["']/gi)]
  .map((match) => match[1])
  .slice(0, 20);

const fetchLike = [...html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+|\/kr\/api\/[^"'<>\s]+|_data=[^"'<>\s&]+/gi)]
  .map((match) => match[0])
  .filter((value) => /api|_data|buy-sell/i.test(value))
  .slice(0, 40);

console.log("DAANGN_CAPTURE=" + JSON.stringify({
  ok: response.ok,
  status: response.status,
  finalUrl: response.url,
  contentType: response.headers.get("content-type"),
  htmlLength: html.length,
  markers: {
    fleamarketArticles: html.includes("fleamarketArticles"),
    remixContext: html.includes("__remixContext"),
    loaderData: html.includes("loaderData"),
    nextData: html.includes("__NEXT_DATA__"),
    ldJson: /application\/ld\+json/i.test(html),
    dataRoute: html.includes("routes/kr.buy-sell._index"),
    dataQuery: html.includes("_data="),
  },
  snippets: {
    fleamarketArticles: around("fleamarketArticles"),
    remixContext: around("__remixContext"),
    loaderData: around("loaderData"),
    buySellRoute: around("routes/kr.buy-sell"),
  },
  scripts: scripts.filter((script) => script.interesting || script.type === "application/ld+json").slice(0, 12),
  buySellHrefs: hrefs,
  endpointHints: fetchLike,
}));
