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
  ADD_CANCELLED_MESSAGE,
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
  const deletions = [];
  return {
    messages,
    edits,
    answers,
    deletions,
    sendMessage: async (payload) => {
      messages.push(payload);
      return { message_id: 77 };
    },
    editMessage: async (payload) => edits.push(payload),
    answerCallback: async (payload) => answers.push(payload),
    deleteMessage: async (payload) => deletions.push(payload),
  };
}

function dependencies(database, telegram, pendingInteractions, overrides = {}) {
  return {
    database,
    sendMessage: telegram.sendMessage,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
    deleteMessage: telegram.deleteMessage,
    allowedChatId: "123",
    pendingInteractions,
    now: () => new Date("2026-09-20T12:00:00Z"),
    ...overrides,
  };
}

function message(text, chatId = 123, messageId = 101) {
  return { message: { chat: { id: chatId }, message_id: messageId, text } };
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

async function send(database, text, telegram, pending, messageId = 101, overrides = {}) {
  return handleTelegramUpdate(
    message(text, 123, messageId),
    dependencies(database, telegram, pending, overrides),
  );
}

async function chooseType(database, type, telegram, pending) {
  return handleTelegramUpdate(
    guitarTypeCallback(type),
    dependencies(database, telegram, pending),
  );
}

async function reachTypeChoice(database, telegram, pending) {
  await send(database, "/add", telegram, pending, 90);
  await send(database, "Yamaha", telegram, pending, 91);
  await send(database, "F310", telegram, pending, 92);
}

async function completeRegistration(database, telegram, pending, overrides = {}) {
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "acoustic", telegram, pending);
  await send(database, "20000", telegram, pending, 93, overrides);
  return send(database, "80000", telegram, pending, 94, overrides);
}

test("/add creates one registration card and stores its mainMessageId", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await send(database, "/add", telegram, pending, 90);

  assert.deepEqual(result, { status: "awaiting_add_brand", mainMessageId: 77 });
  assert.equal(pending.get(123).mainMessageId, 77);
  assert.equal(pending.get(123).step, ADD_STEPS.BRAND);
  assert.match(telegram.messages[0].text, /🎸 새 기타 등록/);
  assert.match(telegram.messages[0].text, /브랜드: 입력 대기/);
  assert.deepEqual(telegram.deletions, [{ chatId: 123, messageId: 90 }]);
}));

test("brand input is deleted and edits the same registration card", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await send(database, "/add", telegram, pending, 90);

  await send(database, "Yamaha", telegram, pending, 91);

  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 91 });
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, /브랜드: Yamaha/);
  assert.match(telegram.edits.at(-1).text, /모델: 입력 대기/);
}));

test("model input edits the same card and shows guitar type buttons", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);

  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 92 });
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, /모델: F310/);
  assert.deepEqual(
    telegram.edits.at(-1).replyMarkup.inline_keyboard.map(
      (row) => row.map(({ text }) => text),
    ),
    [["어쿠스틱", "일렉"], ["기타", "직접 입력"], ["등록 취소"]],
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

    await chooseType(database, choice, telegram, pending);

    assert.equal(pending.get(123).guitarType, expected);
    assert.equal(pending.get(123).step, ADD_STEPS.PURCHASE_PRICE);
    assert.equal(telegram.edits.at(-1).messageId, 77);
    assert.match(telegram.edits.at(-1).text, /매입가: 입력 대기/);
  }));
}

test("supports a custom guitar type on the same card", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "custom", telegram, pending);

  await send(database, "클래식", telegram, pending, 93);

  assert.equal(pending.get(123).guitarType, "클래식");
  assert.match(telegram.edits.at(-1).text, /종류: 클래식/);
}));

test("price inputs are deleted and keep editing the same card", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "acoustic", telegram, pending);

  await send(database, "20000", telegram, pending, 93);

  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 93 });
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, /매입가: 20,000원/);
  assert.match(telegram.edits.at(-1).text, /예상 판매가: 입력 대기/);
}));

test("completion edits the card into inventory detail without a success message", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await completeRegistration(database, telegram, pending);
  const inventory = findInventoryItemByCode(database, "G-0001");
  const acquisition = findAcquisitionById(database, inventory.acquisitionId);

  assert.deepEqual(result, { status: "inventory_added", inventoryItemId: inventory.id });
  assert.equal(telegram.messages.length, 1);
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, /🎸 G-0001 Yamaha F310/);
  assert.match(telegram.edits.at(-1).text, /상태: 재고 보유/);
  assert.equal(acquisition.status, "RECEIVED");
  assert.equal(inventory.state, "IN_STOCK");
  assert.equal(getInventoryDetail(database, inventory.id).cost.expectedProfitKrw, 60000);
}));

test("invalid price is deleted and shown on the same card", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);
  await chooseType(database, "acoustic", telegram, pending);

  const result = await send(database, "12.5", telegram, pending, 93);

  assert.deepEqual(result, { status: "invalid_add_purchase_price" });
  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 93 });
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, new RegExp(INVALID_ADD_PRICE_MESSAGE));
  assert.equal(pending.get(123).step, ADD_STEPS.PURCHASE_PRICE);
}));

test("/cancel is deleted and changes the card without database writes", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await reachTypeChoice(database, telegram, pending);

  const result = await send(database, "/cancel", telegram, pending, 95);

  assert.deepEqual(result, { status: "cancelled" });
  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 95 });
  assert.equal(telegram.edits.at(-1).text, ADD_CANCELLED_MESSAGE);
  assert.equal(telegram.messages.length, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM listings").get().count, 0);
}));

test("cleanup failure is logged but does not undo successful registration", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  const warnings = [];
  const overrides = {
    deleteMessage: async () => { throw new Error("delete denied"); },
    logger: { warn: (...args) => warnings.push(args) },
  };

  const result = await completeRegistration(database, telegram, pending, overrides);

  assert.equal(result.status, "inventory_added");
  assert.equal(findInventoryItemByCode(database, "G-0001").state, "IN_STOCK");
  assert.ok(warnings.length >= 2);
}));

test("unauthorized users cannot start registration or access the database", async () => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  const database = new Proxy({}, {
    get() { throw new Error("database must not be accessed"); },
  });

  const result = await handleTelegramUpdate(
    message("/add", 999, 90),
    dependencies(database, telegram, pending),
  );

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(pending.has(999), false);
  assert.deepEqual(telegram.messages, []);
  assert.deepEqual(telegram.deletions, []);
});


test("the full add flow keeps one bot card through brand, model, type, and completion", async () => withDatabase(async (database) => {
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  await send(database, "/add", telegram, pending, 90);
  await send(database, "Yamaha", telegram, pending, 91);
  await send(database, "F310", telegram, pending, 92);
  await chooseType(database, "other", telegram, pending);
  await send(database, "20000", telegram, pending, 93);
  await send(database, "80000", telegram, pending, 94);

  assert.equal(telegram.messages.length, 1);
  assert.ok(telegram.edits.length >= 4);
  assert.ok(telegram.edits.every(({ messageId }) => messageId === 77));
  assert.deepEqual(
    telegram.deletions,
    [90, 91, 92, 93, 94].map((messageId) => ({ chatId: 123, messageId })),
  );
  assert.match(telegram.edits[0].text, /브랜드: Yamaha/);
  assert.match(telegram.edits[1].text, /모델: F310/);
  assert.match(telegram.edits[2].text, /종류: 기타/);
  assert.match(telegram.edits.at(-1).text, /🎸 G-0001 Yamaha F310/);
  assert.equal(findInventoryItemByCode(database, "G-0001").state, "IN_STOCK");
}));
