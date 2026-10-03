import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mergeBunjangDetail,
  normalizeBunjangSearchItem,
  parseBunjangSearchPayload,
  toListingRecord,
} from "../../src/integrations/bunjang/bunjang-parser.js";

const searchFixture = JSON.parse(readFileSync(
  new URL("../fixtures/bunjang-search.json", import.meta.url),
  "utf8",
));
const detailFixture = JSON.parse(readFileSync(
  new URL("../fixtures/bunjang-detail.json", import.meta.url),
  "utf8",
));
const context = {
  keyword: "통기타",
  discoveredAt: "2026-10-01T10:00:00.000Z",
  sourceUrl: "https://api.bunjang.co.kr/api/1/find_v2.json?q=test",
};

test("normalizes a regular Bunjang search item", () => {
  const [item] = parseBunjangSearchPayload(searchFixture, context);
  assert.equal(item.marketplace, "BUNJANG");
  assert.equal(item.externalListingId, "300001");
  assert.equal(item.title, "야마하 F310 통기타");
  assert.equal(item.priceKrw, 85000);
  assert.equal(item.locationText, "서울 강남구");
  assert.equal(item.status, "SELLING");
  assert.equal(item.url, "https://m.bunjang.co.kr/products/300001");
  assert.match(item.postedAt, /^2026-/);
});

test("accepts zero price and preserves reserved status", () => {
  const items = parseBunjangSearchPayload(searchFixture, context);
  const free = items.find(({ externalListingId }) => externalListingId === "300002");
  assert.equal(free.priceKrw, 0);
  assert.equal(free.status, "RESERVED");
});

test("keeps missing price and location as null for the persistence boundary", () => {
  const items = parseBunjangSearchPayload(searchFixture, context);
  const noPrice = items.find(({ externalListingId }) => externalListingId === "300003");
  const noLocation = items.find(({ externalListingId }) => externalListingId === "300004");
  assert.equal(noPrice.priceKrw, null);
  assert.equal(noLocation.locationText, null);
  assert.deepEqual(toListingRecord(noPrice).missing, ["priceKrw"]);
  assert.deepEqual(toListingRecord(noLocation).missing, []);
  assert.equal(toListingRecord(noLocation).listing.sellerLocationText, null);
  assert.equal(noLocation.status, "SOLD_OUT");
});

test("ignores malformed and advertising items", () => {
  assert.equal(normalizeBunjangSearchItem(null, context), null);
  assert.equal(
    normalizeBunjangSearchItem({ pid: null, name: "broken" }, context),
    null,
  );
  const items = parseBunjangSearchPayload(searchFixture, context);
  assert.equal(items.some(({ externalListingId }) => externalListingId === "999999"), false);
});

test("merges optional detail data without losing search timestamps", () => {
  const [candidate] = parseBunjangSearchPayload(searchFixture, context);
  const merged = mergeBunjangDetail(candidate, detailFixture);
  assert.equal(merged.sellerName, "기타상점");
  assert.equal(merged.locationText, "서울특별시 강남구 역삼동");
  assert.equal(merged.description, "입문용으로 사용한 통기타입니다.");
  assert.equal(merged.status, "SELLING");
  assert.equal(merged.postedAt, candidate.postedAt);
});

test("rejects a mismatched detail id", () => {
  const [candidate] = parseBunjangSearchPayload(searchFixture, context);
  assert.throws(
    () => mergeBunjangDetail(candidate, {
      data:{product:{pid:999999}},
    }),
    /detail id mismatch/,
  );
});
