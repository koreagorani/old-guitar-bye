import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  formatOpportunityMonitorLog,
  loadOpportunityMonitorConfig,
  OpportunityMonitorError,
  runBunjangOpportunityMonitor,
} from "../../src/application/listings/opportunity-monitor.js";

const NOW = new Date("2026-10-17T11:00:00Z");

function searchPayload({
  id = 700001,
  title = "YAMAHA F310 통기타",
  price = 20000,
} = {}) {
  return {
    data: {
      searchSpec: {
        uiBlockList: [{
          id: "mainGrid",
          searchResponse: {
            data: [{
              pid: id,
              name: title,
              price,
              status: "SELLING",
              updatedAt: "2026-10-17T10:55:00Z",
              ad: false,
              type: "PRODUCT",
            }],
          },
        }],
      },
    },
  };
}

function clientFor(payload = searchPayload()) {
  return {
    async search() {
      return {
        data: payload,
        sourceUrl: "https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword?q=test&sort=latest",
      };
    },
  };
}

function resolverAt(price, confidence = "MEDIUM") {
  return {
    async resolve() {
      return {
        referenceNewPriceKrw: price,
        confidence,
      };
    },
  };
}

function config(overrides = {}) {
  return {
    bunjang: {
      keywords: ["통기타"],
      resultsPerKeyword: 20,
      enrichDetails: false,
    },
    lookbackDays: 30,
    thresholdPct: 12,
    ...overrides,
  };
}

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "opportunity-monitor-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return await callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("collect success flows into evaluation and TRACK", async () =>
  withDatabase(async (database) => {
    const result = await runBunjangOpportunityMonitor({
      database,
      client: clientFor(),
      resolver: resolverAt(200000),
      config: config(),
      now: () => NOW,
    });
    assert.equal(result.collector.candidateCount, 1);
    assert.equal(result.collector.savedCount, 1);
    assert.equal(result.evaluator.summary.track, 1);
    assert.equal(result.evaluator.track[0].ratioPct, 10);
  }));

test("track zero is reported without failure", async () =>
  withDatabase(async (database) => {
    const result = await runBunjangOpportunityMonitor({
      database,
      client: clientFor(),
      resolver: resolverAt(100000),
      config: config(),
      now: () => NOW,
    });
    assert.equal(result.evaluator.summary.track, 0);
    assert.equal(result.evaluator.summary.ignore, 1);
    assert.equal(
      formatOpportunityMonitorLog(result).some((line) => line.startsWith("TRACK ")),
      false,
    );
  }));

test("track results are included in journal-friendly log output", async () =>
  withDatabase(async (database) => {
    const result = await runBunjangOpportunityMonitor({
      database,
      client: clientFor(),
      resolver: resolverAt(195000),
      config: config(),
      now: () => NOW,
    });
    const lines = formatOpportunityMonitorLog(result);
    assert.match(lines[0], /^\[collector\] candidates=1 saved=1 skipped=0$/);
    assert.match(lines[1], /^\[evaluator\] track=1 /);
    assert.match(lines[2], /^TRACK YAMAHA F310 20,000 \/ 195,000 = 10\.26%/);
  }));

test("collector failure exits the monitor at COLLECT stage", async () =>
  withDatabase(async (database) => {
    await assert.rejects(
      runBunjangOpportunityMonitor({
        database,
        client: {
          async search() {
            throw new Error("HTTP 429");
          },
        },
        resolver: resolverAt(200000),
        config: config(),
        now: () => NOW,
      }),
      (error) => (
        error instanceof OpportunityMonitorError
        && error.stage === "COLLECT"
        && error.cause.message === "HTTP 429"
      ),
    );
  }));

test("evaluation failure exits the monitor at EVALUATE stage", async () =>
  withDatabase(async (database) => {
    await assert.rejects(
      runBunjangOpportunityMonitor({
        database,
        client: clientFor(),
        resolver: {
          async resolve() {
            throw new Error("resolver exploded");
          },
        },
        config: config(),
        now: () => NOW,
      }),
      (error) => (
        error instanceof OpportunityMonitorError
        && error.stage === "EVALUATE"
        && error.cause.message === "resolver exploded"
      ),
    );
  }));

test("repeated run upserts the same listing instead of duplicating it", async () =>
  withDatabase(async (database) => {
    const args = {
      database,
      client: clientFor(),
      resolver: resolverAt(200000),
      config: config(),
      now: () => NOW,
    };
    await runBunjangOpportunityMonitor(args);
    await runBunjangOpportunityMonitor(args);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM listings").get().count,
      1,
    );
  }));

test("duplicate items in a search response remain one persisted listing", async () =>
  withDatabase(async (database) => {
    const payload = searchPayload();
    payload.data.searchSpec.uiBlockList[0].searchResponse.data.push(
      { ...payload.data.searchSpec.uiBlockList[0].searchResponse.data[0] },
    );
    const result = await runBunjangOpportunityMonitor({
      database,
      client: clientFor(payload),
      resolver: resolverAt(200000),
      config: config(),
      now: () => NOW,
    });
    assert.equal(result.collector.candidateCount, 1);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM listings").get().count,
      1,
    );
  }));

test("monitor env config defaults to conservative collection and 12 percent", () => {
  const parsed = loadOpportunityMonitorConfig({});
  assert.deepEqual(parsed.bunjang.keywords, ["기타", "통기타", "어쿠스틱 기타"]);
  assert.equal(parsed.bunjang.resultsPerKeyword, 20);
  assert.equal(parsed.bunjang.enrichDetails, false);
  assert.equal(parsed.lookbackDays, 30);
  assert.equal(parsed.thresholdPct, 12);
});

test("monitor env config accepts threshold and collection overrides", () => {
  const parsed = loadOpportunityMonitorConfig({
    BUNJANG_SEARCH_KEYWORDS: "통기타",
    BUNJANG_RESULTS_PER_KEYWORD: "5",
    BUNJANG_ENRICH_DETAILS: "true",
    OPPORTUNITY_LOOKBACK_DAYS: "7",
    OPPORTUNITY_THRESHOLD_PCT: "11.5",
  });
  assert.deepEqual(parsed.bunjang.keywords, ["통기타"]);
  assert.equal(parsed.bunjang.resultsPerKeyword, 5);
  assert.equal(parsed.bunjang.enrichDetails, true);
  assert.equal(parsed.lookbackDays, 7);
  assert.equal(parsed.thresholdPct, 11.5);
});
