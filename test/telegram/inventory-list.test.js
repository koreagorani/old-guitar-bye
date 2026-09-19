import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { createAcquisition, updateAcquisitionState } from "../../src/repositories/acquisition-repository.js";
import { createInventoryItem, findInventoryItemByCode, updateInventoryState } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import {
  EMPTY_INVENTORY_MESSAGE,
  INVENTORY_USAGE_MESSAGE,
} from "../../src/telegram/commands/inventory-command.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-list-"));
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

function createInventoryFixture(database, {
  brand = "Yamaha",
  modelName = "F310",
  state = "IN_STOCK",
} = {}) {
  fixtureNumber += 1;
  const inventoryCode = `G-${String(fixtureNumber).padStart(4, "0")}`;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `inventory-list-source-${fixtureNumber}`,
    url: `https://example.com/inventory-list-source-${fixtureNumber}`,
    title: `${brand} ${modelName}`,
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
    brand,
    modelName,
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

function telegramRecorder() {
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

function dependencies(database, telegram) {
  return {
    database,
    sendMessage: telegram.sendMessage,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
    allowedChatId: "123",
  };
}

async function listInventory(database, telegram) {
  return handleTelegramUpdate(
    { message: { chat: { id: 123 }, text: "/inventory" } },
    dependencies(database, telegram),
  );
}

test("/inventory without a code lists current inventory", async () => withDatabase(async (database) => {
  createInventoryFixture(database);
  const telegram = telegramRecorder();

  const result = await listInventory(database, telegram);

  assert.deepEqual(result, { status: "listed", count: 1 });
  assert.match(telegram.messages[0].text, /^🎸 현재 재고/m);
}));

for (const [state, label] of [
  ["IN_STOCK", "재고 보유"],
  ["REPAIRING", "수리 중"],
  ["FOR_SALE", "판매 가능"],
]) {
  test(`shows active ${state} inventory as ${label}`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database, { state });
    const telegram = telegramRecorder();

    await listInventory(database, telegram);

    assert.match(
      telegram.messages[0].text,
      new RegExp(`${inventory.inventoryCode} · Yamaha F310 · ${label}`),
    );
  }));
}

test("excludes SOLD inventory from the current list", async () => withDatabase(async (database) => {
  const active = createInventoryFixture(database);
  const sold = createInventoryFixture(database, { state: "SOLD" });
  const telegram = telegramRecorder();

  const result = await listInventory(database, telegram);

  assert.deepEqual(result, { status: "listed", count: 1 });
  assert.match(telegram.messages[0].text, new RegExp(active.inventoryCode));
  assert.doesNotMatch(telegram.messages[0].text, new RegExp(sold.inventoryCode));
}));

test("sorts the newest inventory id first", async () => withDatabase(async (database) => {
  const oldest = createInventoryFixture(database, { modelName: "F310" });
  const middle = createInventoryFixture(database, { brand: "Cort", modelName: "Earth70" });
  const newest = createInventoryFixture(database, { brand: "Crafter", modelName: "HT-250" });
  const telegram = telegramRecorder();

  await listInventory(database, telegram);

  const text = telegram.messages[0].text;
  assert.ok(text.indexOf(newest.inventoryCode) < text.indexOf(middle.inventoryCode));
  assert.ok(text.indexOf(middle.inventoryCode) < text.indexOf(oldest.inventoryCode));
}));

test("shows only code, brand, model, and Korean state in each list row", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, {
    brand: "Cort",
    modelName: "Earth70",
    state: "FOR_SALE",
  });
  const telegram = telegramRecorder();

  await listInventory(database, telegram);

  assert.match(
    telegram.messages[0].text,
    new RegExp(`${inventory.inventoryCode} · Cort Earth70 · 판매 가능`),
  );
  assert.doesNotMatch(telegram.messages[0].text, /원|수리 기록|총원가/);
}));

test("creates one open callback button per inventory item", async () => withDatabase(async (database) => {
  const first = createInventoryFixture(database, { brand: "Yamaha", modelName: "F310" });
  const second = createInventoryFixture(database, { brand: "Cort", modelName: "Earth70" });
  const telegram = telegramRecorder();

  await listInventory(database, telegram);

  assert.deepEqual(telegram.messages[0].replyMarkup.inline_keyboard, [
    [{
      text: `${second.inventoryCode} Cort Earth70`,
      callback_data: `inventory:open:${second.inventoryCode}`,
    }],
    [{
      text: `${first.inventoryCode} Yamaha F310`,
      callback_data: `inventory:open:${first.inventoryCode}`,
    }],
  ]);
}));

test("selecting a list item edits the list into the existing detail screen", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, { state: "REPAIRING" });
  const telegram = telegramRecorder();

  const result = await handleTelegramUpdate({
    callback_query: {
      id: "open-inventory",
      data: `inventory:open:${inventory.inventoryCode}`,
      message: { chat: { id: 123 }, message_id: 77 },
    },
  }, dependencies(database, telegram));

  assert.deepEqual(result, {
    status: "opened",
    action: "open",
    inventoryItemId: inventory.id,
  });
  assert.equal(telegram.edits[0].messageId, 77);
  assert.match(telegram.edits[0].text, new RegExp(`🎸 ${inventory.inventoryCode} Yamaha F310`));
  assert.match(telegram.edits[0].text, /상태: 수리 중/);
  assert.deepEqual(
    telegram.edits[0].replyMarkup.inline_keyboard[0].map(({ text }) => text),
    ["수리 완료"],
  );
  assert.deepEqual(telegram.answers, [{ callbackQueryId: "open-inventory", text: null }]);
}));

test("opening an inventory item does not change database state", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, { state: "FOR_SALE" });
  const telegram = telegramRecorder();

  await handleTelegramUpdate({
    callback_query: {
      id: "open-inventory",
      data: `inventory:open:${inventory.inventoryCode}`,
      message: { chat: { id: 123 }, message_id: 77 },
    },
  }, dependencies(database, telegram));

  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "FOR_SALE");
}));

test("reports an empty current inventory list without an error", async () => withDatabase(async (database) => {
  const telegram = telegramRecorder();

  const result = await listInventory(database, telegram);

  assert.deepEqual(result, { status: "empty" });
  assert.deepEqual(telegram.messages, [{ chatId: 123, text: EMPTY_INVENTORY_MESSAGE }]);
}));

test("keeps /inventory with an explicit code compatible", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = telegramRecorder();

  const result = await handleTelegramUpdate({
    message: {
      chat: { id: 123 },
      text: `/inventory ${inventory.inventoryCode}`,
    },
  }, dependencies(database, telegram));

  assert.deepEqual(result, { status: "found", inventoryItemId: inventory.id });
  assert.match(telegram.messages[0].text, /매입가:/);
  assert.ok(telegram.messages[0].replyMarkup.inline_keyboard.length > 0);
}));

test("silently blocks unauthorized inventory-list access before database lookup", async () => {
  const database = new Proxy({}, {
    get() {
      throw new Error("database must not be accessed");
    },
  });
  const telegram = telegramRecorder();

  const result = await handleTelegramUpdate(
    { message: { chat: { id: 999 }, text: "/inventory" } },
    dependencies(database, telegram),
  );

  assert.deepEqual(result, { status: "ignored" });
  assert.deepEqual(telegram.messages, []);
});

test("keeps malformed inventory commands on the existing usage response", async () => withDatabase(async (database) => {
  const telegram = telegramRecorder();

  const result = await handleTelegramUpdate(
    { message: { chat: { id: 123 }, text: "/inventory G-0001 extra" } },
    dependencies(database, telegram),
  );

  assert.deepEqual(result, { status: "invalid" });
  assert.equal(telegram.messages[0].text, INVENTORY_USAGE_MESSAGE);
}));
