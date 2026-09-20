import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getInventoryDetail } from "../../src/application/inventory/get-inventory-detail.js";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { createAcquisition, updateAcquisitionState } from "../../src/repositories/acquisition-repository.js";
import { listExpensesByInventoryItemId } from "../../src/repositories/expense-repository.js";
import { createInventoryItem, findInventoryItemByCode, updateInventoryState } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { listRepairLogsByInventoryItemId } from "../../src/repositories/repair-repository.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import {
  EXPENSE_AMOUNT_INPUT_PROMPT,
  EXPENSE_AMOUNT_INPUT_STEP,
  EXPENSE_AMOUNT_MENU_PROMPT,
  EXPENSE_CANCELLED_MESSAGE,
  EXPENSE_INPUT_PROMPT,
  EXPENSE_INPUT_STEP,
  EXPENSE_MENU_PROMPT,
  INVALID_EXPENSE_AMOUNT_MESSAGE,
  INVALID_EXPENSE_INPUT_MESSAGE,
  parseExpenseInput,
} from "../../src/telegram/interactions/expense-flow.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "expense-flow-"));
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
    externalListingId: `expense-flow-source-${fixtureNumber}`,
    url: `https://example.com/expense-flow-source-${fixtureNumber}`,
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
      id: "add-expense-callback",
      data: `inventory:add_expense:${inventoryCode}`,
      message: { chat: { id: chatId }, message_id: 77 },
    },
  };
}

function message(text, chatId = 123) {
  return { message: { chat: { id: chatId }, text } };
}

function expenseCallback(data, chatId = 123) {
  return {
    callback_query: {
      id: `callback-${data}`,
      data,
      message: { chat: { id: chatId }, message_id: 77 },
    },
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
    now: () => new Date("2026-09-19T13:45:00Z"),
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

async function press(database, data, telegram, pendingInteractions, chatId = 123) {
  return handleTelegramUpdate(
    expenseCallback(data, chatId),
    dependencies(database, telegram, pendingInteractions),
  );
}

test("expense action opens the button-based expense menu", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await press(
    database,
    `inventory:expense:${inventory.inventoryCode}`,
    telegram,
    pending,
  );

  assert.deepEqual(result, { status: "expense_menu", inventoryItemId: inventory.id });
  assert.equal(telegram.edits[0].text, EXPENSE_MENU_PROMPT);
  assert.deepEqual(
    telegram.edits[0].replyMarkup.inline_keyboard.map(
      (row) => row.map(({ text }) => text),
    ),
    [["택배", "교통비"], ["기타"], ["뒤로"]],
  );
  assert.equal(pending.has(123), false);
}));

for (const [slug, label, category] of [
  ["delivery", "택배", "LOGISTICS"],
  ["transport", "교통비", "LOGISTICS"],
  ["other", "기타", "OTHER"],
]) {
  test(`selects ${label} and maps it to ${category}`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database);
    const telegram = recorder();
    const pending = createPendingInteractionStore();

    const result = await press(
      database,
      `expense:type:${slug}:${inventory.inventoryCode}`,
      telegram,
      pending,
    );

    assert.deepEqual(result, {
      status: "awaiting_expense_amount_choice",
      expenseType: label,
    });
    assert.equal(pending.get(123).step, EXPENSE_AMOUNT_INPUT_STEP);
    assert.equal(pending.get(123).category, category);
    assert.equal(pending.get(123).description, label);
    assert.equal(telegram.edits[0].text, `${label}\n${EXPENSE_AMOUNT_MENU_PROMPT}`);
    assert.deepEqual(
      telegram.edits[0].replyMarkup.inline_keyboard.map(
        (row) => row.map(({ text }) => text),
      ),
      [["0원", "직접 입력"], ["뒤로"]],
    );
  }));
}

test("zero-amount button saves an expense and refreshes the detail", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await press(
    database,
    `expense:type:delivery:${inventory.inventoryCode}`,
    telegram,
    pending,
  );

  const result = await press(
    database,
    `expense:amount:zero:${inventory.inventoryCode}`,
    telegram,
    pending,
  );
  const [expense] = listExpensesByInventoryItemId(database, inventory.id);

  assert.equal(result.status, "expense_added");
  assert.deepEqual(expense, {
    id: expense.id,
    inventoryItemId: inventory.id,
    category: "LOGISTICS",
    amountKrw: 0,
    note: "택배",
    occurredAt: "2026-09-19T13:45:00.000Z",
  });
  assert.match(telegram.edits.at(-1).text, /비용 기록:\n- 택배 0원/);
  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "REPAIRING");
  assert.equal(pending.has(123), false);
}));

test("custom amount falls back to numeric input and updates totals", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await press(
    database,
    `expense:type:transport:${inventory.inventoryCode}`,
    telegram,
    pending,
  );

  const choiceResult = await press(
    database,
    `expense:amount:custom:${inventory.inventoryCode}`,
    telegram,
    pending,
  );
  assert.deepEqual(choiceResult, { status: "awaiting_expense_amount" });
  assert.equal(telegram.edits.at(-1).text, EXPENSE_AMOUNT_INPUT_PROMPT);

  const saveResult = await enter(database, "4500", telegram, pending);
  const [expense] = listExpensesByInventoryItemId(database, inventory.id);
  const detail = getInventoryDetail(database, inventory.id);
  assert.equal(saveResult.status, "expense_added");
  assert.equal(expense.category, "LOGISTICS");
  assert.equal(expense.note, "교통비");
  assert.equal(expense.amountKrw, 4500);
  assert.equal(detail.cost.expenseCostTotalKrw, 4500);
  assert.equal(detail.cost.totalCostKrw, 44500);
  assert.match(telegram.edits.at(-1).text, /기타비용: 4,500원/);
  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "REPAIRING");
}));

for (const invalidAmount of ["-1", "금액", "1.5", "   "]) {
  test(`rejects invalid direct expense amount ${JSON.stringify(invalidAmount)}`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database);
    const telegram = recorder();
    const pending = createPendingInteractionStore();
    await press(
      database,
      `expense:type:other:${inventory.inventoryCode}`,
      telegram,
      pending,
    );
    await press(
      database,
      `expense:amount:custom:${inventory.inventoryCode}`,
      telegram,
      pending,
    );

    const result = await enter(database, invalidAmount, telegram, pending);

    assert.deepEqual(result, { status: "invalid_expense_input" });
    assert.equal(telegram.messages.at(-1).text, INVALID_EXPENSE_AMOUNT_MESSAGE);
    assert.equal(pending.get(123).step, EXPENSE_AMOUNT_INPUT_STEP);
    assert.deepEqual(listExpensesByInventoryItemId(database, inventory.id), []);
  }));
}

test("back buttons return to the previous expense screen and then detail", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await press(
    database,
    `expense:type:delivery:${inventory.inventoryCode}`,
    telegram,
    pending,
  );

  const menuResult = await press(
    database,
    `expense:back:types:${inventory.inventoryCode}`,
    telegram,
    pending,
  );
  assert.deepEqual(menuResult, { status: "expense_menu" });
  assert.equal(telegram.edits.at(-1).text, EXPENSE_MENU_PROMPT);
  assert.equal(pending.has(123), false);

  const detailResult = await press(
    database,
    `expense:back:detail:${inventory.inventoryCode}`,
    telegram,
    pending,
  );
  assert.deepEqual(detailResult, { status: "expense_menu_closed" });
  assert.match(telegram.edits.at(-1).text, new RegExp(`🎸 ${inventory.inventoryCode}`));
  assert.match(telegram.edits.at(-1).text, /상태: 수리 중/);
}));

test("cancel from custom amount input restores the inventory detail", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await press(
    database,
    `expense:type:other:${inventory.inventoryCode}`,
    telegram,
    pending,
  );
  await press(
    database,
    `expense:amount:custom:${inventory.inventoryCode}`,
    telegram,
    pending,
  );

  const result = await enter(database, "/cancel", telegram, pending);

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(pending.has(123), false);
  assert.equal(telegram.messages.at(-1).text, EXPENSE_CANCELLED_MESSAGE);
  assert.match(telegram.edits.at(-1).text, new RegExp(`🎸 ${inventory.inventoryCode}`));
  assert.deepEqual(listExpensesByInventoryItemId(database, inventory.id), []);
}));

test("unauthorized expense menu callback is ignored before database access", async () => {
  const database = new Proxy({}, {
    get() {
      throw new Error("database must not be accessed");
    },
  });
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await handleTelegramUpdate(
    expenseCallback("expense:type:delivery:G-0001", 999),
    dependencies(database, telegram, pending),
  );

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(pending.has(999), false);
  assert.deepEqual(telegram.edits, []);
});

test("add_expense callback starts the expense input flow", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await begin(database, inventory, telegram, pending);

  assert.deepEqual(result, {
    status: "awaiting_expense_input",
    inventoryItemId: inventory.id,
  });
  assert.equal(telegram.messages[0].text, EXPENSE_INPUT_PROMPT);
  assert.deepEqual(telegram.answers, [{ callbackQueryId: "add-expense-callback" }]);
}));

test("stores an in-memory pending expense interaction", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  await begin(database, inventory, telegram, pending);

  assert.deepEqual(pending.get(123), {
    type: "expense",
    step: EXPENSE_INPUT_STEP,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    detailMessageId: 77,
  });
}));

test("parses a one-word expense description and amount", () => {
  assert.deepEqual(parseExpenseInput("택배 4500"), {
    description: "택배",
    amountKrw: 4500,
  });
});

test("parses a multi-word expense description", () => {
  assert.deepEqual(parseExpenseInput("기타 케이스 구매 12000"), {
    description: "기타 케이스 구매",
    amountKrw: 12000,
  });
});

test("normalizes multiple spaces around the final amount", () => {
  assert.deepEqual(parseExpenseInput("  기타   케이스 구매    12000  "), {
    description: "기타   케이스 구매",
    amountKrw: 12000,
  });
});

test("allows a zero expense amount", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);

  await enter(database, "주차 0", telegram, pending);

  assert.equal(listExpensesByInventoryItemId(database, inventory.id)[0].amountKrw, 0);
  assert.match(telegram.messages.at(-1).text, /주차 \/ 0원/);
}));

for (const [name, input] of [
  ["description-less input", "4500"],
  ["amount-less input", "택배"],
  ["negative amount", "택배 -1000"],
  ["decimal amount", "택배 12.5"],
  ["blank input", "   "],
]) {
  test(`rejects ${name} and keeps pending state`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database);
    const telegram = recorder();
    const pending = createPendingInteractionStore();
    await begin(database, inventory, telegram, pending);

    const result = await enter(database, input, telegram, pending);

    assert.deepEqual(result, { status: "invalid_expense_input" });
    assert.equal(pending.get(123).step, EXPENSE_INPUT_STEP);
    assert.equal(telegram.messages.at(-1).text, INVALID_EXPENSE_INPUT_MESSAGE);
    assert.deepEqual(listExpensesByInventoryItemId(database, inventory.id), []);
  }));
}

test("stores the parsed expense through ExpenseRepository", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);

  const result = await enter(database, "택배 4500", telegram, pending);
  const [expense] = listExpensesByInventoryItemId(database, inventory.id);

  assert.equal(result.status, "expense_added");
  assert.deepEqual(expense, {
    id: expense.id,
    inventoryItemId: inventory.id,
    category: "OTHER",
    amountKrw: 4500,
    note: "택배",
    occurredAt: "2026-09-19T13:45:00.000Z",
  });
  assert.equal(pending.has(123), false);
}));

test("stores every Telegram expense with category OTHER", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);
  await enter(database, "주차비 2000", telegram, pending);

  assert.equal(listExpensesByInventoryItemId(database, inventory.id)[0].category, "OTHER");
}));

test("preserves the expense description in note", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);
  await enter(database, "기타 케이스 구매 12000", telegram, pending);

  assert.equal(
    listExpensesByInventoryItemId(database, inventory.id)[0].note,
    "기타 케이스 구매",
  );
}));

test("does not change Inventory state when adding an expense", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);
  await enter(database, "택배 4500", telegram, pending);

  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "REPAIRING");
}));

test("increases expense cost and total cost", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);
  await enter(database, "택배 4500", telegram, pending);

  const detail = getInventoryDetail(database, inventory.id);
  assert.equal(detail.cost.expenseCostTotalKrw, 4500);
  assert.equal(detail.cost.totalCostKrw, 44500);
}));

test("refreshes the original detail message with updated costs", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);
  await enter(database, "택배 4500", telegram, pending);

  assert.equal(telegram.edits[0].messageId, 77);
  assert.match(telegram.edits[0].text, /기타비용: 4,500원/);
  assert.match(telegram.edits[0].text, /총원가: 44,500원/);
  assert.match(telegram.edits[0].text, /비용 기록:\n- 택배 4,500원/);
  assert.match(telegram.messages.at(-1).text, /비용을 추가했습니다\.\n택배 \/ 4,500원/);
}));

test("cancels and clears pending expense input with /cancel", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);

  const result = await enter(database, "/cancel", telegram, pending);

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(pending.has(123), false);
  assert.equal(telegram.messages.at(-1).text, EXPENSE_CANCELLED_MESSAGE);
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

test("does not consume a pending repair interaction", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  pending.set(123, {
    type: "repair_log",
    step: "AWAITING_REPAIR_TYPE",
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    detailMessageId: 77,
  });

  const result = await enter(database, "줄 교체", telegram, pending);

  assert.equal(result.status, "awaiting_repair_cost");
  assert.equal(pending.get(123).type, "repair_log");
  assert.deepEqual(listExpensesByInventoryItemId(database, inventory.id), []);
  assert.deepEqual(listRepairLogsByInventoryItemId(database, inventory.id), []);
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
  assert.deepEqual(listExpensesByInventoryItemId(database, inventory.id), []);
}));

test("does not report success or clear pending state when database storage fails", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);
  database.exec("DROP TABLE expenses");

  await assert.rejects(
    enter(database, "택배 4500", telegram, pending),
    /no such table: expenses/,
  );

  assert.equal(pending.get(123).step, EXPENSE_INPUT_STEP);
  assert.equal(telegram.messages.some(({ text }) => text.startsWith("비용을 추가했습니다.")), false);
}));

test("allows expense correction for SOLD inventory without changing its state", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, "SOLD");
  const telegram = recorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, telegram, pending);
  await enter(database, "과거 택배비 4500", telegram, pending);

  assert.equal(listExpensesByInventoryItemId(database, inventory.id).length, 1);
  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "SOLD");
}));
