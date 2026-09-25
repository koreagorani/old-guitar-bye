import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { getInventoryDetail } from "../../src/application/inventory/get-inventory-detail.js";
import { createAcquisition, updateAcquisitionState } from "../../src/repositories/acquisition-repository.js";
import { addExpense, findExpenseById } from "../../src/repositories/expense-repository.js";
import { createInventoryItem } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { addRepairLog, findRepairLogById } from "../../src/repositories/repair-repository.js";
import {
  beginRecordEditList,
  handlePendingRecordEditMessage,
  handleRecordEditCallback,
} from "../../src/telegram/interactions/inventory-record-edit-flow.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "record-edit-flow-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    applyMigrations(database);
    return await callback(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

let n = 0;
function fixture(database) {
  n += 1;
  const code = `G-${String(n).padStart(4, "0")}`;
  const listing = saveOrUpdateListing(database, {
    marketplace: "MANUAL",
    externalListingId: `record-flow-${n}`,
    url: `manual://record-flow-${n}`,
    title: "Yamaha F310",
    description: "",
    askingPriceKrw: 40000,
    sellerLocationText: "직접 등록",
    discoveredAt: "2026-09-25T00:00:00Z",
    lastSeenAt: "2026-09-25T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
    agreedPurchasePriceKrw: 40000,
    boughtAt: "2026-09-25T00:00:00Z",
  });
  acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-25T00:00:00Z",
  });
  const inventory = createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode: code,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-25T00:00:00Z",
    expectedSalePriceKrw: 90000,
  });
  const repair = addRepairLog(database, {
    inventoryItemId: inventory.id,
    type: "세척",
    costKrw: 5000,
    performedAt: "2026-09-20T10:00:00Z",
  });
  const expense = addExpense(database, {
    inventoryItemId: inventory.id,
    category: "LOGISTICS",
    amountKrw: 4500,
    note: "택배",
    occurredAt: "2026-09-21T10:00:00Z",
  });
  return { inventory, repair, expense };
}

function recorder() {
  const edits = [];
  const answers = [];
  const deletions = [];
  return {
    edits,
    answers,
    deletions,
    editMessage: async (payload) => edits.push(payload),
    answerCallback: async (payload) => answers.push(payload),
    cleanupMessage: async (payload) => deletions.push(payload),
  };
}

function callback(data) {
  return {
    id: `cb-${data}`,
    data,
    message: { chat: { id: 123 }, message_id: 77 },
  };
}

async function choose(database, data, telegram, pending) {
  return handleRecordEditCallback({
    database,
    callbackQuery: callback(data),
    pendingInteractions: pending,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
  });
}

async function enter(database, text, telegram, pending, messageId = 99) {
  return handlePendingRecordEditMessage({
    database,
    message: { chat: { id: 123 }, message_id: messageId, text },
    pendingInteractions: pending,
    editMessage: telegram.editMessage,
    cleanupMessage: telegram.cleanupMessage,
  });
}

test("lists and selects a repair record by id", async () => withDatabase(async (database) => {
  const { inventory, repair } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await beginRecordEditList({
    database,
    inventory,
    kind: "repair",
    callbackQuery: callback("unused"),
    pendingInteractions: pending,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
  });
  assert.match(telegram.edits.at(-1).text, /수정할 수리 기록/);
  assert.equal(
    telegram.edits.at(-1).replyMarkup.inline_keyboard[0][0].callback_data,
    `record:repair:select:${repair.id}:${inventory.inventoryCode}`,
  );
  await choose(database, `record:repair:select:${repair.id}:${inventory.inventoryCode}`, telegram, pending);
  assert.match(telegram.edits.at(-1).text, /수리 기록 수정/);
}));

test("edits repair content and restores detail on the same message", async () => withDatabase(async (database) => {
  const { inventory, repair } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await choose(database, `record:repair:type:${repair.id}:${inventory.inventoryCode}`, telegram, pending);
  await enter(database, "줄 교체", telegram, pending);
  assert.equal(findRepairLogById(database, repair.id).type, "줄 교체");
  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 99 });
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, /🎸/);
  assert.match(telegram.edits.at(-1).text, /줄 교체/);
}));

test("edits repair cost and recalculates total cost", async () => withDatabase(async (database) => {
  const { inventory, repair } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await choose(database, `record:repair:cost:${repair.id}:${inventory.inventoryCode}`, telegram, pending);
  await enter(database, "9000", telegram, pending);
  const detail = getInventoryDetail(database, inventory.id);
  assert.equal(detail.cost.repairCostTotalKrw, 9000);
  assert.equal(detail.cost.totalCostKrw, 53500);
  assert.match(telegram.edits.at(-1).text, /총원가: 53,500원/);
}));

test("lists and selects an expense record by id", async () => withDatabase(async (database) => {
  const { inventory, expense } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await beginRecordEditList({
    database,
    inventory,
    kind: "expense",
    callbackQuery: callback("unused"),
    pendingInteractions: pending,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
  });
  assert.equal(
    telegram.edits.at(-1).replyMarkup.inline_keyboard[0][0].callback_data,
    `record:expense:select:${expense.id}:${inventory.inventoryCode}`,
  );
  await choose(database, `record:expense:select:${expense.id}:${inventory.inventoryCode}`, telegram, pending);
  assert.match(telegram.edits.at(-1).text, /비용 기록 수정/);
}));

test("edits expense type using the existing delivery transport other mapping", async () => withDatabase(async (database) => {
  const { inventory, expense } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await choose(database, `record:expense:type:${expense.id}:${inventory.inventoryCode}`, telegram, pending);
  assert.deepEqual(
    telegram.edits.at(-1).replyMarkup.inline_keyboard[0].map(({ text }) => text),
    ["택배", "교통비", "기타"],
  );
  await choose(database, `record:expense:set_transport:${expense.id}:${inventory.inventoryCode}`, telegram, pending);
  const updated = findExpenseById(database, expense.id);
  assert.equal(updated.category, "LOGISTICS");
  assert.equal(updated.note, "교통비");
  assert.match(telegram.edits.at(-1).text, /교통비 4,500원/);
}));

test("edits expense amount and recalculates total cost", async () => withDatabase(async (database) => {
  const { inventory, expense } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await choose(database, `record:expense:amount:${expense.id}:${inventory.inventoryCode}`, telegram, pending);
  await enter(database, "7000", telegram, pending);
  const detail = getInventoryDetail(database, inventory.id);
  assert.equal(detail.cost.expenseCostTotalKrw, 7000);
  assert.equal(detail.cost.totalCostKrw, 52000);
  assert.match(telegram.edits.at(-1).text, /총원가: 52,000원/);
}));

test("rejects a repair id owned by another inventory in callback flow", async () => withDatabase(async (database) => {
  const first = fixture(database);
  const second = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  const result = await choose(
    database,
    `record:repair:select:${first.repair.id}:${second.inventory.inventoryCode}`,
    telegram,
    pending,
  );
  assert.deepEqual(result, { status: "record_not_found" });
  assert.match(telegram.answers.at(-1).text, /찾을 수 없습니다/);
}));

test("rejects a missing record id in callback flow", async () => withDatabase(async (database) => {
  const { inventory } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  const result = await choose(
    database,
    `record:expense:select:999:${inventory.inventoryCode}`,
    telegram,
    pending,
  );
  assert.deepEqual(result, { status: "record_not_found" });
}));

test("/cancel cleans user input and restores inventory detail", async () => withDatabase(async (database) => {
  const { inventory, repair } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await choose(database, `record:repair:type:${repair.id}:${inventory.inventoryCode}`, telegram, pending);
  const result = await enter(database, "/cancel", telegram, pending, 101);
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(pending.has(123), false);
  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 101 });
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, new RegExp(inventory.inventoryCode));
}));

test("invalid text input is cleaned up and keeps pending edit state", async () => withDatabase(async (database) => {
  const { inventory, repair } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await choose(database, `record:repair:cost:${repair.id}:${inventory.inventoryCode}`, telegram, pending);
  const result = await enter(database, "-1", telegram, pending, 102);
  assert.deepEqual(result, { status: "invalid_record_edit_input" });
  assert.equal(pending.get(123).recordId, repair.id);
  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 102 });
  assert.equal(findRepairLogById(database, repair.id).costKrw, 5000);
}));

test("record callbacks stay below Telegram callback_data limit", async () => withDatabase(async (database) => {
  const { inventory } = fixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await beginRecordEditList({
    database,
    inventory,
    kind: "repair",
    callbackQuery: callback("unused"),
    pendingInteractions: pending,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
  });
  for (const row of telegram.edits.at(-1).replyMarkup.inline_keyboard) {
    for (const button of row) {
      assert.ok(Buffer.byteLength(button.callback_data, "utf8") <= 64);
    }
  }
}));
