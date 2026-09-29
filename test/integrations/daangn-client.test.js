import assert from "node:assert/strict";
import test from "node:test";

import {
  createDaangnClient,
  DaangnAccessError,
} from "../../src/integrations/daangn/daangn-client.js";

function response({
  status = 200,
  url = "https://www.daangn.com/kr/buy-sell/",
  text = "",
  json = null,
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => text,
    json: async () => json,
  };
}

test("builds a public search URL with keyword and region query", async () => {
  const calls = [];
  const client = createDaangnClient({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ url: String(url), text: "<html></html>" });
    },
  });
  await client.search({ keyword: "통기타", regionSlug: "연수동-1234" });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/kr/buy-sell/all/");
  assert.equal(url.searchParams.get("search"), "통기타");
  assert.equal(url.searchParams.get("in"), "연수동-1234");
  assert.equal(url.searchParams.get("only_on_sale"), "true");
});

test("resolves a region using the public region endpoint", async () => {
  const client = createDaangnClient({
    fetchImpl: async (url) => response({
      url: String(url),
      json: {
        locations: [{
          id: 1234,
          name: "연수동",
          name1: "충청북도",
          name2: "충주시",
          name3: "연수동",
        }],
      },
    }),
  });
  const region = await client.resolveRegion("연수동");
  assert.equal(region.slug, "연수동-1234");
  assert.equal(region.fullName, "충청북도 충주시 연수동");
});

for (const status of [403, 429]) {
  test(`stops on HTTP ${status} without bypassing access controls`, async () => {
    const client = createDaangnClient({
      fetchImpl: async (url) => response({ status, url: String(url) }),
    });
    await assert.rejects(
      client.search({ keyword: "기타" }),
      (error) => error instanceof DaangnAccessError && error.status === status,
    );
  });
}

test("stops when an access challenge is returned", async () => {
  const client = createDaangnClient({
    fetchImpl: async (url) => response({
      url: String(url),
      text: "<html>CAPTCHA</html>",
    }),
  });
  await assert.rejects(
    client.search({ keyword: "기타" }),
    /access challenge/,
  );
});


test("validates request timeout", () => {
  assert.throws(
    () => createDaangnClient({ fetchImpl: async () => {}, timeoutMs: 0 }),
    /timeoutMs must be a positive safe integer/,
  );
});
