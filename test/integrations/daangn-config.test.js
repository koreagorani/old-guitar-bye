import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_KEYWORDS,
  loadDaangnConfig,
} from "../../src/integrations/daangn/daangn-config.js";

test("provides configurable PoC keywords", () => {
  assert.deepEqual(loadDaangnConfig({}).keywords, [...DEFAULT_KEYWORDS]);
  assert.deepEqual(
    loadDaangnConfig({ DAANGN_SEARCH_KEYWORDS: "기타, 통기타,기타" }).keywords,
    ["기타", "통기타"],
  );
});

test("supports optional region and result limit", () => {
  assert.deepEqual(
    loadDaangnConfig({
      DAANGN_REGION: "연수동",
      DAANGN_RESULTS_PER_KEYWORD: "5",
    }),
    {
      keywords: [...DEFAULT_KEYWORDS],
      region: "연수동",
      resultsPerKeyword: 5,
    },
  );
});
