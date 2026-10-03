import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseAcousticMartSearchHtml,
} from "../../src/integrations/new-price/acousticmart-source.js";
import {
  parseMovlandSearchHtml,
} from "../../src/integrations/new-price/movland-source.js";
import {
  parseBuzzbeeSearchHtml,
} from "../../src/integrations/new-price/buzzbee-source.js";
import {
  createGopherwoodSource,
  parseGopherwoodSearchHtml,
} from "../../src/integrations/new-price/gopherwood-source.js";

const acoustic = readFileSync(
  new URL("../fixtures/acousticmart-search.html", import.meta.url),
  "utf8",
);
const movland = readFileSync(
  new URL("../fixtures/movland-search.html", import.meta.url),
  "utf8",
);
const buzzbee = readFileSync(
  new URL("../fixtures/buzzbee-search.html", import.meta.url),
  "utf8",
);
const gopherwood = readFileSync(
  new URL("../fixtures/gopherwood-search.html", import.meta.url),
  "utf8",
);

test("parses AcousticMart product title, sale price, url, and stock", () => {
  const products = parseAcousticMartSearchHtml(acoustic, {
    observedAt: "2026-10-03T08:00:00Z",
  });
  assert.equal(products.length, 3);
  assert.deepEqual(products[0], {
    source: "ACOUSTICMART",
    productTitle: "야마하 통기타 YAMAHA F310 NT",
    priceKrw: 190000,
    url: "https://www.acousticmart.co.kr/product/detail.html?product_no=2260&cate_no=283&display_group=1",
    inStock: true,
    observedAt: "2026-10-03T08:00:00Z",
  });
});

test("parses Movland/SchoolMusic search cards", () => {
  const products = parseMovlandSearchHtml(movland, {
    observedAt: "2026-10-03T08:00:00Z",
  });
  assert.equal(products.length, 2);
  assert.equal(products[0].productTitle, "야마하 Yamaha F310 통기타 (TBS)");
  assert.equal(products[0].priceKrw, 205000);
  assert.equal(products[0].inStock, true);
  assert.match(products[0].url, /Good_no=37033/);
});


test("parses Buzzbee visible sale price instead of MSRP", () => {
  const products = parseBuzzbeeSearchHtml(buzzbee, {
    observedAt: "2026-10-03T08:00:00Z",
  });
  assert.equal(products.length, 3);
  assert.equal(products[0].productTitle, "[초보자기타의 베스트셀러] Cort 어쿠스틱기타 Earth100");
  assert.equal(products[0].priceKrw, 319000);
  assert.equal(products[0].inStock, true);
  assert.match(products[0].url, /goodsNo=3291/);
  assert.equal(products[2].inStock, false);
});

test("parses Gopherwood official sale price and stock status", () => {
  const products = parseGopherwoodSearchHtml(gopherwood, {
    observedAt: "2026-10-03T08:00:00Z",
  });
  assert.equal(products.length, 2);
  assert.equal(products[0].productTitle, "Gopherwood G110");
  assert.equal(products[0].priceKrw, 235000);
  assert.equal(products[0].inStock, true);
  assert.equal(products[1].priceKrw, 189000);
  assert.equal(products[1].inStock, false);
});

test("Gopherwood official source skips unsupported brands without network access", async () => {
  let calls = 0;
  const source = createGopherwoodSource({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("should not fetch");
    },
  });
  const result = await source.search({
    brand: "YAMAHA",
    observedAt: "2026-10-03T08:00:00Z",
  });
  assert.deepEqual(result, { products: [], sourceUrl: null });
  assert.equal(calls, 0);
});
