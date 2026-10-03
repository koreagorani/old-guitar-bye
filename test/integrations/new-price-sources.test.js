import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseAcousticMartSearchHtml,
} from "../../src/integrations/new-price/acousticmart-source.js";
import {
  parseMovlandSearchHtml,
} from "../../src/integrations/new-price/movland-source.js";

const acoustic = readFileSync(
  new URL("../fixtures/acousticmart-search.html", import.meta.url),
  "utf8",
);
const movland = readFileSync(
  new URL("../fixtures/movland-search.html", import.meta.url),
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
