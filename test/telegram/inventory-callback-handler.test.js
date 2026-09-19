import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  handleTelegramUpdate,
  processTelegramUpdates,
} from "../../src/telegram/bot.js";
import { createAcquisition, updateAcquisitionState } from "../../src/repositories/acquisition-repository.js";
import { createInventoryItem, findInventoryItemByCode, updateInventoryState } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import {
  CALLBACK_MESSAGES,
  handleInventoryCallback,
  INVALID_CALLBACK_MESSAGE,
  INVALID_STATE_MESSAGE,
  INVENTORY_NOT_FOUND_CALLBACK_MESSAGE,
} from "../../src/telegram/callbacks/inventory-callback-handler.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-callback-"));
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

function createInventoryFixture(database, state = "IN_STOCK") {
  fixtureNumber += 1;
  const inventoryCode = `G-${String(fixtureNumber).padStart(4, "0")}`;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `callback-source-${fixtureNumber}`,
    url: `https://example.com/callback-source-${fixtureNumber}`,
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
  } else if (state === "FOR_SALE") {
    inventory = updateInventoryState(database, inventory.id, "FOR_SALE");
  }
  return inventory;
}

function callbackQuery(action, inventoryCode, chatId = 123) {
  return {
    id: `callback-${action}`,
    data: `inventory:${action}:${inventoryCode}`,
    message: { chat: { id: chatId }, message_id: 77 },
  };
}

function telegramRecorder() {
  const edits = [];
  const answers = [];
  return {
    edits,
    answers,
    editMessage: async (message) => edits.push(message),
    answerCallback: async (answer) => answers.push(answer),
  };
}

async function handle(database, query, recorder = telegramRecorder()) {
  const result = await handleInventoryCallback({
    database,
    callbackQuery: query,
    editMessage: recorder.editMessage,
    answerCallback: recorder.answerCallback,
  });
  return { result, recorder };
}

test("start_repair changes IN_STOCK to REPAIRING", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const { result, recorder } = await handle(
    database,
    callbackQuery("start_repair", inventory.inventoryCode),
  );

  assert.equal(result.status, "updated");
  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "REPAIRING");
  assert.equal(recorder.answers[0].text, CALLBACK_MESSAGES.start_repair);
}));

test("mark_for_sale changes IN_STOCK to FOR_SALE", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const { recorder } = await handle(
    database,
    callbackQuery("mark_for_sale", inventory.inventoryCode),
  );

  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "FOR_SALE");
  assert.equal(recorder.answers[0].text, CALLBACK_MESSAGES.mark_for_sale);
}));

test("finish_repair changes REPAIRING to FOR_SALE", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, "REPAIRING");
  const { recorder } = await handle(
    database,
    callbackQuery("finish_repair", inventory.inventoryCode),
  );

  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "FOR_SALE");
  assert.equal(recorder.answers[0].text, CALLBACK_MESSAGES.finish_repair);
}));

test("isolates a failed callback update and continues with finish_repair", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const answers = [];
  const logged = [];
  let editCalls = 0;
  const updates = [
    {
      update_id: 10,
      callback_query: callbackQuery("start_repair", inventory.inventoryCode),
    },
    {
      update_id: 11,
      callback_query: callbackQuery("finish_repair", inventory.inventoryCode),
    },
  ];

  const offset = await processTelegramUpdates(updates, {
    offset: 0,
    database,
    editMessage: async () => {
      editCalls += 1;
      if (editCalls === 1) {
        throw new Error("Telegram edit failed");
      }
    },
    answerCallback: async (answer) => answers.push(answer),
    allowedChatId: "123",
    logger: { error: (...args) => logged.push(args) },
  });

  assert.equal(offset, 12);
  assert.equal(editCalls, 2);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "Failed to handle Telegram update");
  assert.equal(logged[0][1].updateId, 10);
  assert.match(logged[0][1].error.message, /Telegram edit failed/);
  assert.deepEqual(answers, [
    { callbackQueryId: "callback-start_repair" },
    {
      callbackQueryId: "callback-finish_repair",
      text: CALLBACK_MESSAGES.finish_repair,
    },
  ]);
  assert.equal(
    findInventoryItemByCode(database, inventory.inventoryCode).state,
    "FOR_SALE",
  );
}));

test("renders the latest detail and buttons after a state change", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const { recorder } = await handle(
    database,
    callbackQuery("start_repair", inventory.inventoryCode),
  );

  assert.match(recorder.edits[0].text, /상태: 수리 중/);
  assert.deepEqual(
    recorder.edits[0].replyMarkup.inline_keyboard[0].map(({ text }) => text),
    ["수리 완료"],
  );
  assert.equal(recorder.edits[0].messageId, 77);
}));

test("rejects an action that is invalid for the current state", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const { result, recorder } = await handle(
    database,
    callbackQuery("finish_repair", inventory.inventoryCode),
  );

  assert.equal(result.status, "invalid_state");
  assert.equal(recorder.answers[0].text, INVALID_STATE_MESSAGE);
  assert.equal(recorder.edits.length, 0);
}));

test("keeps state after a rejected action", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  await handle(database, callbackQuery("finish_repair", inventory.inventoryCode));

  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "IN_STOCK");
}));

test("handles a missing inventory without editing a message", async () => withDatabase(async (database) => {
  const { result, recorder } = await handle(
    database,
    callbackQuery("start_repair", "G-9999"),
  );

  assert.deepEqual(result, { status: "not_found", inventoryCode: "G-9999" });
  assert.equal(recorder.answers[0].text, INVENTORY_NOT_FOUND_CALLBACK_MESSAGE);
  assert.equal(recorder.edits.length, 0);
}));

test("silently ignores an unauthorized callback before database access", async () => {
  const database = new Proxy({}, {
    get() {
      throw new Error("database must not be accessed");
    },
  });
  const result = await handleTelegramUpdate(
    { callback_query: callbackQuery("start_repair", "G-0001", 999) },
    {
      database,
      editMessage: () => { throw new Error("must not edit"); },
      answerCallback: () => { throw new Error("must not answer"); },
      allowedChatId: "123",
    },
  );

  assert.deepEqual(result, { status: "ignored" });
});

test("routes an authorized callback through the bot entry point", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = telegramRecorder();
  const result = await handleTelegramUpdate(
    { callback_query: callbackQuery("start_repair", inventory.inventoryCode) },
    {
      database,
      editMessage: recorder.editMessage,
      answerCallback: recorder.answerCallback,
      allowedChatId: "123",
    },
  );

  assert.equal(result.status, "updated");
  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "REPAIRING");
}));

test("rejects malformed callback data before database access", async () => {
  const database = new Proxy({}, {
    get() {
      throw new Error("database must not be accessed");
    },
  });
  const recorder = telegramRecorder();
  const query = callbackQuery("start_repair", "G-0001");
  query.data = "inventory:broken";
  const { result } = await handle(database, query, recorder);

  assert.deepEqual(result, { status: "invalid" });
  assert.equal(recorder.answers[0].text, INVALID_CALLBACK_MESSAGE);
});
