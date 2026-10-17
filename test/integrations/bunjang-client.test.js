import assert from "node:assert/strict";
import test from "node:test";

import {
  BunjangAccessError,
  createBunjangClient,
} from "../../src/integrations/bunjang/bunjang-client.js";

function response({
  status=200,
  url="https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword",
  body={data:{searchSpec:{uiBlockList:[]}}},
}={}) {
  return {
    ok:status >= 200 && status < 300,
    status,
    url,
    text:async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}

test("builds the low-frequency public search API request", async () => {
  const calls=[];
  const client=createBunjangClient({
    fetchImpl:async (url,options) => {
      calls.push({url:String(url),options});
      return response({url:String(url)});
    },
  });
  await client.search({keyword:"통기타",limit:5});
  const url=new URL(calls[0].url);
  assert.equal(url.pathname,"/api/search/v8/pw/product/specs/keyword");
  assert.equal(url.searchParams.get("q"),"통기타");
  assert.equal(url.searchParams.get("sort"),"latest");
  assert.equal(url.searchParams.has("page"),false);
  assert.equal(url.searchParams.has("size"),false);
  assert.equal(url.searchParams.has("n"),false);
});

test("builds public detail API request", async () => {
  const calls=[];
  const client=createBunjangClient({
    fetchImpl:async (url) => {
      calls.push(String(url));
      return response({url:String(url),body:{data:{product:{pid:300001}}}});
    },
  });
  await client.detail("300001");
  const url=new URL(calls[0]);
  assert.equal(url.pathname,"/api/pms/v3/products-detail/300001");
  assert.equal(url.searchParams.get("viewerUid"),"-1");
});

for (const status of [403,404,429]) {
  test(`stops on HTTP ${status}`, async () => {
    const client=createBunjangClient({
      fetchImpl:async (url) => response({status,url:String(url)}),
    });
    await assert.rejects(
      client.search({keyword:"통기타",limit:5}),
      (error) => error instanceof BunjangAccessError && error.status === status,
    );
  });
}

test("stops on access challenge content", async () => {
  const client=createBunjangClient({
    fetchImpl:async (url) => response({
      url:String(url),
      body:"CAPTCHA",
    }),
  });
  await assert.rejects(client.search({keyword:"통기타"}),/access challenge/);
});

test("rejects malformed non-JSON success response", async () => {
  const client=createBunjangClient({
    fetchImpl:async (url) => response({url:String(url),body:"not json"}),
  });
  await assert.rejects(client.search({keyword:"통기타"}),/non-JSON/);
});
