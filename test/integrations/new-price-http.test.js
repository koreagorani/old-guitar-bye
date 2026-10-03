import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchPublicHtml,
  NewPriceSourceAccessError,
} from "../../src/integrations/new-price/new-price-http.js";

function response(status, body = "<html></html>") {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://example.com/search",
    headers: { get: () => "text/html; charset=utf-8" },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

for (const status of [403, 429]) {
  test(`retail HTTP helper stops on ${status}`, async () => {
    await assert.rejects(
      fetchPublicHtml({
        fetchImpl: async () => response(status),
        source: "TEST",
        url: new URL("https://example.com/search"),
        timeoutMs: 1000,
      }),
      (error) => error instanceof NewPriceSourceAccessError
        && error.status === status,
    );
  });
}

test("retail HTTP helper surfaces network errors", async () => {
  await assert.rejects(
    fetchPublicHtml({
      fetchImpl: async () => { throw new Error("network down"); },
      source: "TEST",
      url: new URL("https://example.com/search"),
      timeoutMs: 1000,
    }),
    /network down/,
  );
});

test("retail HTTP helper rejects access challenge body", async () => {
  await assert.rejects(
    fetchPublicHtml({
      fetchImpl: async () => response(200, "CAPTCHA"),
      source: "TEST",
      url: new URL("https://example.com/search"),
      timeoutMs: 1000,
    }),
    /access challenge/,
  );
});
