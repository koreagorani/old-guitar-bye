const urls = [
  ["PAGE0", "https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword?q=%ED%86%B5%EA%B8%B0%ED%83%80&sort=latest&page=0"],
  ["PAGE1", "https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword?q=%ED%86%B5%EA%B8%B0%ED%83%80&sort=latest&page=1"],
  ["SIZE5", "https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword?q=%ED%86%B5%EA%B8%B0%ED%83%80&sort=latest&page=0&size=5"],
  ["DETAIL", "https://api.bunjang.co.kr/api/pms/v3/products-detail/437205904?viewerUid=-1"],
];

function mainGrid(payload) {
  const list = payload?.data?.searchSpec?.uiBlockList;
  if (!Array.isArray(list)) return null;
  return list.find((block) => block?.id === "mainGrid")
    ?? list.find((block) => block?.searchResponse?.data);
}

for (const [name, url] of urls) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "old-guitar-bye/0.1 bunjang-current-structure-poc",
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}

    if (name === "DETAIL") {
      console.log("BUNJANG_TARGETED_CAPTURE=" + JSON.stringify({
        name,
        status: response.status,
        contentType: response.headers.get("content-type"),
        topKeys: payload ? Object.keys(payload) : [],
        dataKeys: payload?.data ? Object.keys(payload.data) : [],
        productKeys: payload?.data?.product ? Object.keys(payload.data.product) : [],
        shopKeys: payload?.data?.shop ? Object.keys(payload.data.shop) : [],
        product: payload?.data?.product ? Object.fromEntries(
          Object.entries(payload.data.product)
            .filter(([key]) => /^(pid|id|name|price|saleStatus|description|geo|geoLabel|condition|updatedAt|createdAt)$/i.test(key))
        ) : null,
        shop: payload?.data?.shop ? Object.fromEntries(
          Object.entries(payload.data.shop)
            .filter(([key]) => /^(uid|name|shopName|nickName)$/i.test(key))
        ) : null,
        preview: text.slice(0, 1200),
      }));
      continue;
    }

    const grid = mainGrid(payload);
    const data = grid?.searchResponse?.data;
    const context = payload?.loggingContext ?? payload?.data?.loggingContext;
    let searchOptions = context?.searchOptions ?? null;
    try { searchOptions = JSON.parse(searchOptions); } catch {}

    console.log("BUNJANG_TARGETED_CAPTURE=" + JSON.stringify({
      name,
      status: response.status,
      finalUrl: response.url,
      topKeys: payload ? Object.keys(payload) : [],
      dataKeys: payload?.data ? Object.keys(payload.data) : [],
      searchSpecKeys: payload?.data?.searchSpec ? Object.keys(payload.data.searchSpec) : [],
      gridKeys: grid ? Object.keys(grid) : [],
      searchResponseKeys: grid?.searchResponse ? Object.keys(grid.searchResponse) : [],
      itemCount: Array.isArray(data) ? data.length : null,
      firstIds: Array.isArray(data) ? data.slice(0, 8).map((item) => item.pid) : [],
      firstItems: Array.isArray(data) ? data.slice(0, 3).map((item) => ({
        pid: item.pid,
        name: item.name,
        price: item.price,
        status: item.status,
        updatedAt: item.updatedAt,
        ad: item.ad,
        type: item.type,
      })) : [],
      loggingContext: context ?? null,
      parsedSearchOptions: searchOptions,
    }));
  } catch (error) {
    console.log("BUNJANG_TARGETED_CAPTURE=" + JSON.stringify({
      name,
      success: false,
      error: error?.message ?? String(error),
    }));
  }
}
