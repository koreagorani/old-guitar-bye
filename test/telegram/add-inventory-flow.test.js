import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getInventoryDetail } from "../../src/application/inventory/get-inventory-detail.js";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { findAcquisitionById } from "../../src/repositories/acquisition-repository.js";
import { findInventoryItemByCode } from "../../src/repositories/inventory-repository.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import {
  ADD_BRAND_PROMPT,
  ADD_CANCELLED_MESSAGE,
  ADD_EXPECTED_SALE_PRICE_PROMPT,
  ADD_GUITAR_TYPE_PROMPT,
  ADD_MODEL_PROMPT,
  ADD_PURCHASE_PRICE_PROMPT,
  ADD_STEPS,
  INVALID_ADD_PRICE_MESSAGE,
} from "../../src/telegram/interactions/add-inventory-flow.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "add-inventory-flow-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return await callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
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

function dependencies(database, telegram, pendingInteractions) {
  return {
    database,
    sendMessage: telegram.sendMessage,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
    allowedChatId: "123",
    pendingInteractions,
    now: () => new Date("2026-09-20T12:00:00Z"),
  };
}

function message(text, chatId = 123) {
  return { message: { chat: { id: chatId }, text } };
}

function guitarTypeCallback(type, chatId = 123) {
  return {
    callback_query: {
      id: `add-${type}`,
      data: `add:guitar_type:${type}`,
      message: { chat: { id: chatId }, message_id: 77 },
    },
  };
}

async function send(database, text, telegram, pending) {
  return handleTelegramUpdate(
    message(text),
    dependencies(database, telegram, pending),
  );
}

async function chooseType(database, type, telegram, pending, chatId = 123) {
  return handleTelegramUpdate(
    guitarTypeCallback(type, chatId),
    dependencies(database, telegram, pending),
  );
}

async function reachTypeChoice(database, telegram, pending) {
  await send(database, "/add", telegram, pending);
  await send(database, "Yamaha", telegram, pending);
  await send(database, "F310", telegram, pending);
}

async function completeRegistration(database, telegram, pending) {
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "acoustic", telegram, pending);
  await send(database, "20000", telegram, pending);
  return send(database, "80000", telegram, pending);
}

test("/add starts an in-memory registration flow", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await send(database, "/add", telegram, pending);

  assert.deepEqual(result, { status: "awaiting_add_brand" });
  assert.equal(pending.get(123).step, ADD_STEPS.BRAND);
  assert.equal(telegram.messages.at(-1).text, ADD_BRAND_PROMPT);
}));

test("collects brand and model before showing guitar type buttons", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await send(database, "/add", telegram, pending);

  assert.deepEqual(await send(database, "Yamaha", telegram, pending), {
    status: "awaiting_add_model",
  });
  assert.equal(telegram.messages.at(-1).text, ADD_MODEL_PROMPT);
  assert.deepEqual(await send(database, "F310", telegram, pending), {
    status: "awaiting_add_guitar_type",
  });
  assert.equal(telegram.messages.at(-1).text, ADD_GUITAR_TYPE_PROMPT);
  assert.deepEqual(
    telegram.messages.at(-1).replyMarkup.inline_keyboard.map(
      (row) => row.map(({ text }) => text),
    ),
    [["어쿠스틱", "일렉"], ["기타", "직접 입력"]],
  );
}));

for (const [choice, expected] of [
  ["acoustic", "ACOUSTIC"],
  ["electric", "ELECTRIC"],
  ["other", "OTHER"],
]) {
  test(`selects ${choice} as ${expected}`, async () => withDatabase(async (database) => {
    const telegram = recorder();
    const pending = createPendingInteractionStore();
    await reachTypeChoice(database, telegram, pending);

    const result = await chooseType(database, choice, telegram, pending);

    assert.deepEqual(result, { status: "awaiting_add_purchase_price" });
    assert.equal(pending.get(123).guitarType, expected);
    assert.equal(telegram.edits.at(-1).text, ADD_PURCHASE_PRICE_PROMPT);
  }));
}

test("supports a custom guitar type", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "custom", telegram, pending);

  const result = await send(database, "클래식", telegram, pending);

  assert.deepEqual(result, { status: "awaiting_add_purchase_price" });
  assert.equal(pending.get(123).guitarType, "클래식");
}));

test("collects purchase price and expected sale price", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "acoustic", telegram, pending);

  const result = await send(database, "20000", telegram, pending);

  assert.deepEqual(result, { status: "awaiting_add_expected_sale_price" });
  assert.equal(pending.get(123).purchasePriceKrw, 20000);
  assert.equal(telegram.messages.at(-1).text, ADD_EXPECTED_SALE_PRICE_PROMPT);
}));

test("creates a RECEIVED acquisition and an IN_STOCK inventory item", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await completeRegistration(database, telegram, pending);
  const inventory = findInventoryItemByCode(database, "G-0001");
  const acquisition = findAcquisitionById(database, inventory.acquisitionId);

  assert.deepEqual(result, { status: "inventory_added", inventoryItemId: inventory.id });
  assert.equal(acquisition.status, "RECEIVED");
  assert.equal(acquisition.agreedPurchasePriceKrw, 20000);
  assert.equal(inventory.state, "IN_STOCK");
  assert.equal(inventory.expectedSalePriceKrw, 80000);
  assert.equal(pending.has(123), false);
}));

test("the registered inventory can be queried in detail", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await completeRegistration(database, telegram, pending);

  const inventory = findInventoryItemByCode(database, "G-0001");
  const detail = getInventoryDetail(database, inventory.id);

  assert.equal(detail.inventory.brand, "Yamaha");
  assert.equal(detail.inventory.modelName, "F310");
  assert.equal(telegram.messages.at(-1).replyMarkup.inline_keyboard[0][0].callback_data,
    "inventory:open:G-0001");
}));

for (const invalidPrice of ["-1", "가격", "12.5", "   "]) {
  test(`rejects invalid purchase price ${JSON.stringify(invalidPrice)}`, async () => withDatabase(async (database) => {
    const telegram = recorder();
    const pending = createPendingInteractionStore();
    await reachTypeChoice(database, telegram, pending);
    await chooseType(database, "acoustic", telegram, pending);

    const result = await send(database, invalidPrice, telegram, pending);

    assert.deepEqual(result, { status: "invalid_add_purchase_price" });
    assert.equal(telegram.messages.at(-1).text, INVALID_ADD_PRICE_MESSAGE);
    assert.equal(pending.get(123).step, ADD_STEPS.PURCHASE_PRICE);
  }));
}

test("rejects an invalid expected sale price without writing data", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "acoustic", telegram, pending);
  await send(database, "20000", telegram, pending);

  const result = await send(database, "8만원", telegram, pending);

  assert.deepEqual(result, { status: "invalid_add_expected_sale_price" });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_items").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM acquisitions").get().count, 0);
}));

test("/cancel clears registration without database writes", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);

  const result = await send(database, "/cancel", telegram, pending);

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(telegram.messages.at(-1).text, ADD_CANCELLED_MESSAGE);
  assert.equal(pending.has(123), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
}));

test("unauthorized users cannot start registration or create pending state", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await handleTelegramUpdate(
    message("/add", 999),
    dependencies(database, telegram, pending),
  );

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(pending.has(999), false);
  assert.deepEqual(telegram.messages, []);
}));
