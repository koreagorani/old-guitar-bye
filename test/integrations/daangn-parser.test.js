import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractDaangnExternalListingId,
  inspectDaangnSearchHtml,
  normalizeDaangnArticle,
  parseDaangnSearchHtml,
  toListingRecord,
} from "../../src/integrations/daangn/daangn-parser.js";

const fixture = readFileSync(
  new URL("../fixtures/daangn-search.html", import.meta.url),
  "utf8",
);
const liveFixture = readFileSync(
  new URL("../fixtures/daangn-live-remix-search.html", import.meta.url),
  "utf8",
);
const context = {
  keyword: "통기타",
  discoveredAt: "2026-09-29T10:00:00.000Z",
  sourceUrl: "https://www.daangn.com/kr/buy-sell/?search=test",
};

test("parses a normal Daangn listing into a normalized candidate", () => {
  const [item] = parseDaangnSearchHtml(fixture, context);
  assert.deepEqual(item, {
    marketplace: "DAANGN",
    externalListingId: "g110abc123",
    title: "고퍼우드 G110 통기타",
    priceKrw: 70000,
    url: "https://www.daangn.com/kr/buy-sell/%EA%B3%A0%ED%8D%BC%EC%9A%B0%EB%93%9C-g110-g110abc123/",
    locationText: "연수동",
    sellerName: "기타좋아",
    status: "Ongoing",
    postedAt: "2026-09-29T08:00:00Z",
    discoveredAt: "2026-09-29T10:00:00.000Z",
    description: "입문용 통기타입니다.",
    sourceMetadata: {
      keyword: "통기타",
      status: "Ongoing",
      categoryName: "취미/게임/음반",
      sourceUrl: context.sourceUrl,
    },
  });
});

test("maps explicit free sharing to zero price", () => {
  const items = parseDaangnSearchHtml(fixture, context);
  const free = items.find(({ externalListingId }) => externalListingId === "freeabc999");
  assert.equal(free.priceKrw, 0);
});

test("keeps unavailable location and negotiated price as null", () => {
  const items = parseDaangnSearchHtml(fixture, context);
  const noLocation = items.find(({ externalListingId }) => externalListingId === "noloc123");
  const noPrice = items.find(({ externalListingId }) => externalListingId === "noprice77");
  assert.equal(noLocation.locationText, null);
  assert.equal(noPrice.priceKrw, null);
  assert.deepEqual(toListingRecord(noLocation).missing, []);
  assert.equal(toListingRecord(noLocation).listing.sellerLocationText, null);
  assert.deepEqual(toListingRecord(noPrice).missing, ["priceKrw"]);
});

test("ignores malformed entries instead of inventing fields", () => {
  const items = parseDaangnSearchHtml(fixture, context);
  assert.equal(items.length, 4);
  assert.equal(items.some(({ externalListingId }) => externalListingId === "broken"), false);
});

test("extracts listing ids from both slugs and direct ids", () => {
  assert.equal(extractDaangnExternalListingId("abc123"), "abc123");
  assert.equal(
    extractDaangnExternalListingId(
      "https://www.daangn.com/kr/buy-sell/통기타-xyz789/",
    ),
    "xyz789",
  );
});

test("supports JSON-LD ItemList fallback when hydration data is absent", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type":"ItemList",
    itemListElement:[{
      item:{
        name:"크래프터 통기타",
        url:"https://www.daangn.com/kr/buy-sell/크래프터-abc777/",
        offers:{price:"120000",seller:{name:"판매자"}},
      },
    }],
  })}</script>`;
  const [item] = parseDaangnSearchHtml(html, context);
  assert.equal(item.externalListingId, "abc777");
  assert.equal(item.priceKrw, 120000);
  assert.equal(item.sellerName, "판매자");
  assert.equal(item.locationText, null);
});

test("normalizeDaangnArticle rejects entries without a stable id or title", () => {
  assert.equal(normalizeDaangnArticle({ title: "", href: "/x" }, context), null);
});


test("parses the current live Remix loaderData buySellArticles shape", () => {
  const items = parseDaangnSearchHtml(liveFixture, context);
  const item = items.find(({ externalListingId }) => externalListingId === "live001");
  assert.equal(item.title, "야마하 F310 통기타");
  assert.equal(item.priceKrw, 85000);
  assert.equal(item.locationText, "연수동");
  assert.equal(item.status, "Ongoing");
  assert.equal(item.postedAt, "2026-09-29T18:00:00+09:00");
  assert.equal(item.sellerName, "기타생활");
  assert.match(item.url, /live001\/$/);
});

test("live Remix parser preserves free, missing price, missing location, and sold status", () => {
  const items = parseDaangnSearchHtml(liveFixture, context);
  assert.equal(
    items.find(({ externalListingId }) => externalListingId === "free002").priceKrw,
    0,
  );
  assert.equal(
    items.find(({ externalListingId }) => externalListingId === "noprice003").priceKrw,
    null,
  );
  const closed = items.find(({ externalListingId }) => externalListingId === "noloc004");
  assert.equal(closed.locationText, null);
  assert.equal(closed.status, "Closed");
  assert.equal(
    items.some(({ externalListingId }) => externalListingId === "broken005"),
    false,
  );
});


test("inspects the live Remix article container separately from empty search data", () => {
  const inspection = inspectDaangnSearchHtml(liveFixture);
  assert.deepEqual(inspection, {
    remixContextFound: true,
    routeKey: "routes/kr.search.buy-sell._index",
    articleContainerFound: true,
    articleCount: 6,
    productAdsCount: 1,
  });
});
