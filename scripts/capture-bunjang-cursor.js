const base = new URL("https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword");
base.searchParams.set("q", "통기타");
base.searchParams.set("sort", "latest");

async function get(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "old-guitar-bye/0.1 bunjang-current-structure-poc",
    },
    signal: AbortSignal.timeout(15000),
  });
  const payload = JSON.parse(await response.text());
  const grid = payload?.data?.searchSpec?.uiBlockList?.find(
    (block) => block?.id === "mainGrid",
  );
  return {
    response,
    payload,
    grid,
    data: grid?.searchResponse?.data ?? [],
    cursor: grid?.searchResponse?.cursor ?? null,
    nextCursor: grid?.searchResponse?.nextCursor ?? null,
  };
}

try {
  const first = await get(base);
  console.log("BUNJANG_CURSOR_CAPTURE=" + JSON.stringify({
    name: "FIRST",
    status: first.response.status,
    itemCount: first.data.length,
    firstIds: first.data.slice(0, 8).map((item) => item.pid),
    cursor: first.cursor,
    nextCursor: first.nextCursor,
  }));

  if (first.nextCursor) {
    const nextUrl = new URL(base);
    nextUrl.searchParams.set("cursor", first.nextCursor);
    const second = await get(nextUrl);
    console.log("BUNJANG_CURSOR_CAPTURE=" + JSON.stringify({
      name: "NEXT_WITH_CURSOR",
      status: second.response.status,
      finalUrl: second.response.url,
      itemCount: second.data.length,
      firstIds: second.data.slice(0, 8).map((item) => item.pid),
      cursor: second.cursor,
      nextCursor: second.nextCursor,
      loggingContext: second.payload?.data?.loggingContext ?? null,
    }));
  }
} catch (error) {
  console.log("BUNJANG_CURSOR_CAPTURE=" + JSON.stringify({
    success: false,
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
  }));
}
