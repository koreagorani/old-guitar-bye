import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  formatOpportunityTelegramMessage,
  loadOpportunityTelegramConfig,
  notifyTrackOpportunities,
} from "../../src/application/listings/opportunity-notifier.js";
import { registerTrackCandidates } from "../../src/repositories/opportunity-candidate-repository.js";
import {
  findOpportunityNotification,
  saveOpportunityNotification,
} from "../../src/repositories/opportunity-notification-repository.js";

function track(overrides = {}) {
  return {
    marketplace: "BUNJANG",
    externalListingId: "track-1",
    title: "고퍼우드 G110 통기타",
    url: "https://m.bunjang.co.kr/products/track-1",
    askingPriceKrw: 20000,
    relevance: "RELEVANT",
    guitarType: "ACOUSTIC",
    brand: "GOPHERWOOD",
    model: "G110",
    variant: null,
    identityConfidence: "HIGH",
    referenceNewPriceKrw: 235000,
    referenceConfidence: "MEDIUM",
    ratioPct: (20000 / 235000) * 100,
    decision: "TRACK",
    reasons: [],
    ...overrides,
  };
}

function registered(database, opportunities) {
  const insert = database.prepare("INSERT INTO listings (marketplace, external_listing_id, url, title, description, asking_price_krw, discovered_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const item of opportunities) insert.run(item.marketplace, item.externalListingId, item.url, item.title, "", item.askingPriceKrw, "2026-10-17T11:00:00Z", "2026-10-17T11:00:00Z");
  return registerTrackCandidates(database, opportunities).candidates;
}
async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "opportunity-notifier-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return await callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("TRACK sends once then dedupes the repeated listing", async () =>
  withDatabase(async (database) => {
    const sent = [];
    const args = {
      database,
      opportunities: registered(database, [track()]),
      chatId: "123",
      sendMessage: async (message) => sent.push(message),
      now: () => new Date("2026-10-17T12:00:00Z"),
    };

    const first = await notifyTrackOpportunities(args);
    const second = await notifyTrackOpportunities(args);

    assert.deepEqual(
      { sent: first.sent, duplicate: first.duplicate, failed: first.failed },
      { sent: 1, duplicate: 0, failed: 0 },
    );
    assert.deepEqual(
      { sent: second.sent, duplicate: second.duplicate, failed: second.failed },
      { sent: 0, duplicate: 1, failed: 0 },
    );
    assert.equal(sent.length, 1);
  }));

test("two TRACK listings send two individual Telegram messages", async () =>
  withDatabase(async (database) => {
    const sent = [];
    const result = await notifyTrackOpportunities({
      database,
      opportunities: registered(database, [
        track({ externalListingId: "one" }),
        track({
          externalListingId: "two",
          title: "YAMAHA F310 통기타",
          brand: "YAMAHA",
          model: "F310",
        }),
      ]),
      chatId: 123,
      sendMessage: async (message) => sent.push(message),
      now: () => new Date("2026-10-17T12:00:00Z"),
    });
    assert.equal(result.sent, 2);
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0].text, sent[1].text);
  }));

test("existing notification row skips Telegram send", async () =>
  withDatabase(async (database) => {
    const opportunity = track();
    saveOpportunityNotification(database, {
      marketplace: "BUNJANG",
      externalListingId: opportunity.externalListingId,
      notifiedAt: "2026-10-17T11:00:00Z",
      askingPriceKrw: opportunity.askingPriceKrw,
      referenceNewPriceKrw: opportunity.referenceNewPriceKrw,
      ratioPct: opportunity.ratioPct,
    });
    let sends = 0;
    const result = await notifyTrackOpportunities({
      database,
      opportunities: registered(database, [opportunity]),
      chatId: "123",
      sendMessage: async () => { sends += 1; },
    });
    assert.equal(result.duplicate, 1);
    assert.equal(sends, 0);
  }));

test("IGNORE and unresolved decisions never send", async () =>
  withDatabase(async (database) => {
    let sends = 0;
    const result = await notifyTrackOpportunities({
      database,
      opportunities: [
        track({ externalListingId: "ignore", decision: "IGNORE" }),
        track({
          externalListingId: "identity",
          decision: "UNRESOLVED_IDENTITY",
        }),
        track({
          externalListingId: "reference",
          decision: "UNRESOLVED_REFERENCE",
        }),
      ],
      chatId: "123",
      sendMessage: async () => { sends += 1; },
    });
    assert.equal(sends, 0);
    assert.deepEqual(
      { sent: result.sent, duplicate: result.duplicate, failed: result.failed },
      { sent: 0, duplicate: 0, failed: 0 },
    );
  }));

test("Telegram failure does not record and next cycle can retry", async () =>
  withDatabase(async (database) => {
    const opportunity = track();
    const failed = await notifyTrackOpportunities({
      database,
      opportunities: registered(database, [opportunity]),
      chatId: "123",
      sendMessage: async () => {
        throw new Error("Telegram sendMessage failed: Too Many Requests");
      },
    });
    assert.equal(failed.failed, 1);
    assert.equal(
      findOpportunityNotification(database, "BUNJANG", opportunity.externalListingId),
      null,
    );

    let sends = 0;
    const retried = await notifyTrackOpportunities({
      database,
      opportunities: registered(database, [opportunity]),
      chatId: "123",
      sendMessage: async () => { sends += 1; },
      now: () => new Date("2026-10-17T12:30:00Z"),
    });
    assert.equal(retried.sent, 1);
    assert.equal(sends, 1);
    assert.ok(
      findOpportunityNotification(database, "BUNJANG", opportunity.externalListingId),
    );
  }));

test("successful send is recorded with observed prices", async () =>
  withDatabase(async (database) => {
    const opportunity = track();
    await notifyTrackOpportunities({
      database,
      opportunities: registered(database, [opportunity]),
      chatId: "123",
      sendMessage: async () => {},
      now: () => new Date("2026-10-17T12:00:00Z"),
    });
    const row = findOpportunityNotification(
      database,
      "BUNJANG",
      opportunity.externalListingId,
    );
    assert.equal(row.askingPriceKrw, 20000);
    assert.equal(row.referenceNewPriceKrw, 235000);
    assert.equal(row.notifiedAt, "2026-10-17T12:00:00.000Z");
    assert.ok(Math.abs(row.ratioPct - opportunity.ratioPct) < 1e-9);
  }));

test("database unique constraint enforces marketplace and external id dedupe", async () =>
  withDatabase(async (database) => {
    const record = {
      marketplace: "BUNJANG",
      externalListingId: "same",
      notifiedAt: "2026-10-17T12:00:00Z",
      askingPriceKrw: 10000,
      referenceNewPriceKrw: 100000,
      ratioPct: 10,
    };
    saveOpportunityNotification(database, record);
    assert.throws(
      () => saveOpportunityNotification(database, record),
      /UNIQUE constraint failed/,
    );
  }));

test("Telegram message is concise and contains required listing fields", () => {
  const text = formatOpportunityTelegramMessage(track({ variant: "NAT" }));
  assert.match(text, /🎸 매입 후보 발견/);
  assert.match(text, /GOPHERWOOD G110 \[NAT\]/);
  assert.match(text, /중고가: 20,000원/);
  assert.match(text, /신품가: 235,000원/);
  assert.match(text, /신품 대비: 8\.51%/);
  assert.match(text, /고퍼우드 G110 통기타/);
  assert.match(text, /https:\/\/m\.bunjang\.co\.kr\/products\/track-1/);
  assert.doesNotMatch(text, /confidence/i);
});

test("Telegram env config reuses existing bot secrets", () => {
  const config = loadOpportunityTelegramConfig({
    TELEGRAM_BOT_TOKEN: " bot-token ",
    TELEGRAM_ALLOWED_CHAT_ID: "-1234567890123",
  });
  assert.deepEqual(config, {
    token: "bot-token",
    chatId: "-1234567890123",
  });
});

test("Telegram env config rejects missing credentials", () => {
  assert.throws(
    () => loadOpportunityTelegramConfig({ TELEGRAM_ALLOWED_CHAT_ID: "123" }),
    /TELEGRAM_BOT_TOKEN/,
  );
  assert.throws(
    () => loadOpportunityTelegramConfig({ TELEGRAM_BOT_TOKEN: "token" }),
    /TELEGRAM_ALLOWED_CHAT_ID/,
  );
});
