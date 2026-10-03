const sources = [
  {
    source: "FREEBUD",
    url: "https://www.freebud.co.kr/goods/goods_search.php?keyword=YAMAHA%20F310",
  },
  {
    source: "ACOUSTICMART",
    url: "https://www.acousticmart.co.kr/product/search.html?keyword=YAMAHA%20F310",
  },
  {
    source: "MOVLAND",
    url: "https://www.movland.co.kr/Shop/index.php3?var=Search&keyword=YAMAHA%20F310",
  },
];

function snippets(html) {
  const markers = ["F310", "goodsNo", "goods_view", "product_no", "Good_no", "품절", "판매가"];
  const result = {};
  for (const marker of markers) {
    const index = html.toLowerCase().indexOf(marker.toLowerCase());
    result[marker] = index < 0
      ? null
      : html.slice(Math.max(0, index - 900), Math.min(html.length, index + 1800));
  }
  return result;
}

for (const source of sources) {
  try {
    const response = await fetch(source.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "old-guitar-bye/0.1 new-price-source-poc",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const html = await response.text();
    console.log("NEW_PRICE_CAPTURE=" + JSON.stringify({
      source: source.source,
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      htmlLength: html.length,
      f310Count: (html.match(/F310/gi) ?? []).length,
      soldOutCount: (html.match(/(?:SOLD\s*OUT|품절)/gi) ?? []).length,
      snippets: snippets(html),
    }));
  } catch (error) {
    console.log("NEW_PRICE_CAPTURE=" + JSON.stringify({
      source: source.source,
      success: false,
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
    }));
  }
}
