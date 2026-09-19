import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getInventoryDetail } from "../../src/application/inventory/get-inventory-detail.js";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { createAcquisition, updateAcquisitionState } from "../../src/repositories/acquisition-repository.js";
import { createInventoryItem, findInventoryItemByCode, updateInventoryState } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { listRepairLogsByInventoryItemId } from "../../src/repositories/repair-repository.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import {
  INVALID_REPAIR_COST_MESSAGE,
  INVALID_REPAIR_TYPE_MESSAGE,
  REPAIR_CANCELLED_MESSAGE,
  REPAIR_COST_PROMPT,
  REPAIR_INPUT_STEPS,
  REPAIR_TYPE_PROMPT,
} from "../../src/telegram/interactions/repair-log-flow.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "repair-log-flow-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return await callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

let fixtureNumber = 0;

function createInventoryFixture(database, state = "REPAIRING") {
  fixtureNumber += 1;
  const inventoryCode = `G-${String(fixtureNumber).padStart(4, "0")}`;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `repair-flow-source-${fixtureNumber}`,
    url: `https://example.com/repair-flow-source-${fixtureNumber}`,
    title: "Yamaha F310",
    description: "Playable used guitar",
    askingPriceKrw: 50000,
    sellerLocationText: "Seoul",
    discoveredAt: "2026-09-01T00:00:00Z",
    lastSeenAt: "2026-09-01T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
    boughtAt: "2026-09-02T00:00:00Z",
    agreedPurchasePriceKrw: 40000,
  });
  acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-03T00:00:00Z",
  });
  let inventory = createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-03T00:00:00Z",
    expectedSalePriceKrw: 90000,
  });
  if (state === "REPAIRING") {
    inventory = updateInventoryState(database, inventory.id, "REPAIRING");
  } else if (state === "FOR_SALE" || state === "SOLD") {
    inventory = updateInventoryState(database, inventory.id, "FOR_SALE");
    if (state === "SOLD") {
      inventory = updateInventoryState(database, inventory.id, "SOLD");
    }
  }
  return inventory;
}

function recorder() {
  const messages = [];
  const edits = [];
  const answers = [];
  return {
    messages,
    edits,
    answers,
    sendMessage: async (payload) => messages.push(payload),
    editMessage: async (payload) => edits.push(payload),
    answerCallback: async (payload) => answers.push(payload),
  };
}

function callback(inventoryCode, chatId = 123) {
  return {
    callback_query: {
      id: "add-repair-log-callback",
      data: `inventory:add_repair_log:${inventoryCode}`,
      message: { chat: { id: chatId }, message_id: 77 },
    },
  };
}

function message(text, chatId = 123) {
  return { message: { chat: { id: chatId }, text } };
}

function dependencies(database, telegram, pendingInteractions) {
  return {
    database,
    sendMessage: telegram.sendMessage,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
    allowedChatId: "123",
    pendingInteractions,
    now: () => new Date("2026-09-19T12:34:56Z"),
  };
}

async function begin(database, inventory, telegram, pendingInteractions) {
  return handleTelegramUpdate(
    callback(inventory.inventoryCode),
    dependencies(database, telegram, pendingInteractions),
  );
}

async function enter(database, text, telegram, pendingInteractions) {
  return handleTelegramUpdate(
    message(text),
    dependencies(database, telegram, pendingInteractions),
  );
}

async function enterType(database, inventory, telegram, pendingInteractions, type = "줄 교체") {
  await begin(database, inventory, telegram, pendingInteractions);
  return enter(database, type, telegram, pendingInteractions);
}

test("add_repair_log callback starts the repair input flow", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await begin(database, inventory, telegram, pending);

  assert.deepEqual(result, {
    status: "awaiting_repair_type",
    inventoryItemId: inventory.id,
  });
  assert.equal(telegram.messages[0].text, REPAIR_TYPE_PROMPT);
  assert.deepEqual(telegram.answers, [{ callbackQueryId: "add-repair-log-callback" }]);
}));

test("stores an in-memory pending repair type interaction", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  await begin(database, inventory, telegram, pending);

  assert.deepEqual(pending.get(123), {
    type: "repair_log",
    step: REPAIR_INPUT_STEPS.TYPE,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    detailMessageId: 77,
  });
}));

test("accepts a repair description and moves to the cost step", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);

  const result = await enter(database, "  줄 교체  ", telegram, pending);

  assert.deepEqual(result, { status: "awaiting_repair_cost" });
  assert.equal(pending.get(123).step, REPAIR_INPUT_STEPS.COST);
  assert.equal(pending.get(123).repairType, "줄 교체");
  assert.equal(telegram.messages.at(-1).text, REPAIR_COST_PROMPT);
}));

test("rejects an empty repair description without advancing", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);

  const result = await enter(database, "   ", telegram, pending);

  assert.deepEqual(result, { status: "invalid_repair_type" });
  assert.equal(pending.get(123).step, REPAIR_INPUT_STEPS.TYPE);
  assert.equal(telegram.messages.at(-1).text, INVALID_REPAIR_TYPE_MESSAGE);
}));

test("stores a repair log through RepairRepository with the requested defaults", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await enterType(database, inventory, telegram, pending);

  const result = await enter(database, "8000", telegram, pending);
  const [repair] = listRepairLogsByInventoryItemId(database, inventory.id);

  assert.equal(result.status, "repair_log_added");
  assert.deepEqual(repair, {
    id: repair.id,
    inventoryItemId: inventory.id,
    type: "줄 교체",
    costKrw: 8000,
    minutesSpent: null,
    note: null,
    performedAt: "2026-09-19T12:34:56.000Z",
  });
  assert.equal(pending.has(123), false);
}));

test("allows a zero repair cost", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await enterType(database, inventory, telegram, pending, "세척");

  await enter(database, "0", telegram, pending);

  assert.equal(listRepairLogsByInventoryItemId(database, inventory.id)[0].costKrw, 0);
  assert.match(telegram.messages.at(-1).text, /세척 \/ 0원/);
}));

for (const invalidCost of ["-1", "abc", "1.5", "   "]) {
  test(`rejects invalid repair cost ${JSON.stringify(invalidCost)}`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database);
    const telegram = recorder();
    const pending = createPendingInteractionStore();
    await enterType(database, inventory, telegram, pending);

    const result = await enter(database, invalidCost, telegram, pending);

    assert.deepEqual(result, { status: "invalid_repair_cost" });
    assert.equal(pending.get(123).step, REPAIR_INPUT_STEPS.COST);
    assert.equal(telegram.messages.at(-1).text, INVALID_REPAIR_COST_MESSAGE);
    assert.deepEqual(listRepairLogsByInventoryItemId(database, inventory.id), []);
  }));
}

test("does not change the Inventory state when adding a repair log", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await enterType(database, inventory, telegram, pending);
  await enter(database, "8000", telegram, pending);

  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "REPAIRING");
}));

test("increases repair cost and total cost in the refreshed detail", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await enterType(database, inventory, telegram, pending);
  await enter(database, "8000", telegram, pending);

  const detail = getInventoryDetail(database, inventory.id);
  assert.equal(detail.cost.repairCostTotalKrw, 8000);
  assert.equal(detail.cost.totalCostKrw, 48000);
  assert.match(telegram.edits[0].text, /수리비: 8,000원/);
  assert.match(telegram.edits[0].text, /총원가: 48,000원/);
}));

test("refreshes the original detail message with the repair record", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await enterType(database, inventory, telegram, pending);
  await enter(database, "8000", telegram, pending);

  assert.equal(telegram.edits[0].messageId, 77);
  assert.match(telegram.edits[0].text, /수리 기록:\n- 줄 교체 8,000원/);
  assert.match(telegram.messages.at(-1).text, /수리 기록을 추가했습니다\.\n줄 교체 \/ 8,000원/);
}));

test("cancels a pending repair log with /cancel", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);

  const result = await enter(database, "/cancel", telegram, pending);

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(pending.has(123), false);
  assert.equal(telegram.messages.at(-1).text, REPAIR_CANCELLED_MESSAGE);
}));

test("an unauthorized callback cannot create pending state or access the database", async () => {
  const database = new Proxy({}, {
    get() {
      throw new Error("database must not be accessed");
    },
  });
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await handleTelegramUpdate(callback("G-0001", 999), {
    ...dependencies(database, telegram, pending),
    sendMessage: () => { throw new Error("must not send"); },
    answerCallback: () => { throw new Error("must not answer"); },
  });

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(pending.has(999), false);
});

test("allows a historical repair correction for SOLD inventory", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, "SOLD");
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await enterType(database, inventory, telegram, pending, "과거 줄 교체");

  await enter(database, "5000", telegram, pending);

  assert.equal(listRepairLogsByInventoryItemId(database, inventory.id).length, 1);
  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "SOLD");
}));

test("does not consume a pending complete-sale interaction", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, "FOR_SALE");
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  pending.set(123, {
    type: "complete_sale",
    step: "AWAITING_SALE_PRICE",
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    detailMessageId: 77,
  });

  const result = await enter(database, "75000", telegram, pending);

  assert.equal(result.status, "sale_completed");
  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "SOLD");
  assert.deepEqual(listRepairLogsByInventoryItemId(database, inventory.id), []);
}));

test("does not report success or clear pending state when the database write fails", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await enterType(database, inventory, telegram, pending);
  database.exec("DROP TABLE repair_logs");

  await assert.rejects(
    enter(database, "8000", telegram, pending),
    /no such table: repair_logs/,
  );

  assert.equal(pending.get(123).step, REPAIR_INPUT_STEPS.COST);
  assert.equal(telegram.messages.some(({ text }) => text.startsWith("수리 기록을 추가했습니다.")), false);
}));
