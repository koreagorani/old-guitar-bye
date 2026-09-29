import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractDaangnExternalListingId,
  normalizeDaangnArticle,
  parseDaangnSearchHtml,
  toListingRecord,
} from "../../src/integrations/daangn/daangn-parser.js";

const fixture = readFileSync(
  new URL("../fixtures/daangn-search.html", import.meta.url),
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
    url: "https://www.daangn.com/kr/buy-sell/고퍼우드-g110-g110abc123/",
    locationText: "연수동",
    sellerName: "기타좋아",
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
  assert.deepEqual(toListingRecord(noLocation).missing, ["locationText"]);
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
