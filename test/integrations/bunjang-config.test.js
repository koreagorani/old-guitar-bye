import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_KEYWORDS,
  loadBunjangConfig,
} from "../../src/integrations/bunjang/bunjang-config.js";

test("provides the requested default search keywords", () => {
  assert.deepEqual(loadBunjangConfig({}).keywords,[...DEFAULT_KEYWORDS]);
});

test("supports keyword, limit, and optional detail configuration", () => {
  assert.deepEqual(
    loadBunjangConfig({
      BUNJANG_SEARCH_KEYWORDS:"기타,통기타,기타",
      BUNJANG_RESULTS_PER_KEYWORD:"5",
      BUNJANG_ENRICH_DETAILS:"true",
    }),
    {
      keywords:["기타","통기타"],
      resultsPerKeyword:5,
      enrichDetails:true,
    },
  );
});
