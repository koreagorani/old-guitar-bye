const keyword = "통기타";
const url = new URL(`https://m.bunjang.co.kr/keywords/${encodeURIComponent(keyword)}`);

const response = await fetch(url, {
  method: "GET",
  headers: {
    Accept: "text/html,application/xhtml+xml",
    "User-Agent": "old-guitar-bye/0.1 bunjang-read-only-poc",
  },
  redirect: "follow",
  signal: AbortSignal.timeout(15000),
});
const html = await response.text();

function around(marker, radius = 800) {
  const index = html.indexOf(marker);
  if (index < 0) return null;
  return html.slice(
    Math.max(0, index - radius),
    Math.min(html.length, index + marker.length + radius),
  );
}

const productAnchors = [...html.matchAll(
  /<a[^>]+href=["']([^"']*\/products\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
)].slice(0, 10).map((match) => ({
  href: match[1],
  id: match[2],
  text: match[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
}));

const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .map((match, index) => {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    return {
      index,
      type: /type=["']([^"']+)["']/i.exec(attrs)?.[1] ?? null,
      id: /id=["']([^"']+)["']/i.exec(attrs)?.[1] ?? null,
      src: /src=["']([^"']+)["']/i.exec(attrs)?.[1] ?? null,
      length: body.length,
      interesting: /product|keyword|search|apollo|next|redux|price|region/i.test(body),
      preview: /product|keyword|search|apollo|next|redux|price|region/i.test(body)
        ? body.slice(0, 1800)
        : null,
    };
  });

const endpointHints = [...html.matchAll(
  /https?:\\?\/\\?\/[^"'<>\s]+|\/(?:api|search|products)[^"'<>\s]*/gi,
)]
  .map((match) => match[0])
  .filter((value) => /api|search|product/i.test(value))
  .slice(0, 60);

console.log("BUNJANG_CAPTURE=" + JSON.stringify({
  ok: response.ok,
  status: response.status,
  finalUrl: response.url,
  contentType: response.headers.get("content-type"),
  htmlLength: html.length,
  markers: {
    nextData: html.includes("__NEXT_DATA__"),
    nextPush: html.includes("__next_f.push"),
    apollo: /apollo/i.test(html),
    redux: /redux/i.test(html),
    products: html.includes("/products/"),
    ldJson: /application\/ld\+json/i.test(html),
  },
  snippets: {
    nextData: around("__NEXT_DATA__"),
    nextPush: around("__next_f.push"),
    firstProduct: around("/products/"),
    apiBunjang: around("api.bunjang.co.kr"),
  },
  productAnchors,
  scripts: scripts.filter((script) => script.interesting || script.type === "application/ld+json").slice(0, 15),
  endpointHints,
}));
