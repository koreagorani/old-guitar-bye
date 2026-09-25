import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  createAcquisition,
  updateAcquisitionState,
} from "../../src/repositories/acquisition-repository.js";
import {
  createInventoryItem,
  findInventoryItemByCode,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";
import {
  EDIT_PRICE_FIELDS,
  EXPECTED_SALE_PRICE_INPUT_PROMPT,
  INVALID_EDIT_PRICE_MESSAGE,
  PURCHASE_PRICE_INPUT_PROMPT,
} from "../../src/telegram/interactions/inventory-edit-price-flow.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-edit-price-"));
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

function createInventoryFixture(database) {
  fixtureNumber += 1;
  const inventoryCode = `G-${String(fixtureNumber).padStart(4, "0")}`;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `edit-price-${fixtureNumber}`,
    url: `https://example.com/edit-price-${fixtureNumber}`,
    title: "Yamaha F310",
    description: "Playable used guitar",
    askingPriceKrw: 50000,
    sellerLocationText: "Seoul",
    discoveredAt: "2026-09-25T00:00:00Z",
    lastSeenAt: "2026-09-25T00:00:00Z",
  });
  let acquisition = createAcquisition(database, { listingId: listing.id });
  acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
    boughtAt: "2026-09-25T01:00:00Z",
    agreedPurchasePriceKrw: 40000,
  });
  acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
    receivedAt: "2026-09-25T02:00:00Z",
  });
  return createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-25T02:00:00Z",
    expectedSalePriceKrw: 90000,
  });
}

function recorder() {
  const edits = [];
  const answers = [];
  const deletions = [];
  return {
    edits,
    answers,
    deletions,
    editMessage: async (value) => edits.push(value),
    answerCallback: async (value) => answers.push(value),
    deleteMessage: async (value) => deletions.push(value),
    sendMessage: async () => {},
  };
}

function dependencies(database, telegram, pendingInteractions) {
  return {
    database,
    pendingInteractions,
    editMessage: telegram.editMessage,
    answerCallback: telegram.answerCallback,
    deleteMessage: telegram.deleteMessage,
    sendMessage: telegram.sendMessage,
    allowedChatId: "123",
  };
}

function callback(action, inventoryCode) {
  return {
    callback_query: {
      id: `callback-${action}`,
      data: `inventory:${action}:${inventoryCode}`,
      message: { chat: { id: 123 }, message_id: 77 },
    },
  };
}

function message(text) {
  return {
    message: {
      message_id: 99,
      chat: { id: 123 },
      text,
    },
  };
}

test("opens the edit menu from inventory detail", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await handleTelegramUpdate(
    callback("edit", inventory.inventoryCode),
    dependencies(database, telegram, pending),
  );

  assert.deepEqual(result, { status: "edit_menu", inventoryItemId: inventory.id });
  assert.deepEqual(
    telegram.edits[0].replyMarkup.inline_keyboard.map(
      (row) => row.map(({ text }) => text),
    ),
    [["매입가 수정", "예상 판매가 수정"], ["뒤로"]],
  );
  assert.equal(pending.has(123), false);
}));

test("updates purchase price through pending input and cleans up the user message", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const begin = await handleTelegramUpdate(
    callback("edit_purchase_price", inventory.inventoryCode),
    dependencies(database, telegram, pending),
  );
  assert.equal(begin.status, "awaiting_edit_price");
  assert.equal(begin.field, EDIT_PRICE_FIELDS.PURCHASE);
  assert.equal(telegram.edits[0].text, PURCHASE_PRICE_INPUT_PROMPT);
  assert.deepEqual(pending.get(123), {
    type: "edit_price",
    field: EDIT_PRICE_FIELDS.PURCHASE,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    mainMessageId: 77,
  });

  const result = await handleTelegramUpdate(
    message("55000"),
    dependencies(database, telegram, pending),
  );

  assert.deepEqual(result, {
    status: "price_updated",
    field: EDIT_PRICE_FIELDS.PURCHASE,
    inventoryItemId: inventory.id,
    priceKrw: 55000,
  });
  assert.equal(
    findInventoryItemByCode(database, inventory.inventoryCode).purchasePriceKrw,
    55000,
  );
  assert.equal(pending.has(123), false);
  assert.deepEqual(telegram.deletions, [{ chatId: 123, messageId: 99 }]);
  assert.equal(telegram.edits.at(-1).messageId, 77);
}));

test("updates expected sale price through the same pending flow", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  await handleTelegramUpdate(
    callback("edit_expected_sale_price", inventory.inventoryCode),
    dependencies(database, telegram, pending),
  );
  assert.equal(telegram.edits[0].text, EXPECTED_SALE_PRICE_INPUT_PROMPT);

  const result = await handleTelegramUpdate(
    message("120000"),
    dependencies(database, telegram, pending),
  );

  assert.equal(result.status, "price_updated");
  assert.equal(result.field, EDIT_PRICE_FIELDS.EXPECTED_SALE);
  assert.equal(
    findInventoryItemByCode(database, inventory.inventoryCode).expectedSalePriceKrw,
    120000,
  );
  assert.equal(telegram.edits.at(-1).messageId, 77);
}));

for (const invalid of ["-1", "1.5", "가격", "   "]) {
  test(`rejects invalid edit price ${JSON.stringify(invalid)} and keeps pending state`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database);
    const telegram = recorder();
    const pending = createPendingInteractionStore();

    await handleTelegramUpdate(
      callback("edit_purchase_price", inventory.inventoryCode),
      dependencies(database, telegram, pending),
    );
    const result = await handleTelegramUpdate(
      message(invalid),
      dependencies(database, telegram, pending),
    );

    assert.deepEqual(result, { status: "invalid_edit_price" });
    assert.equal(pending.get(123).type, "edit_price");
    assert.equal(telegram.edits.at(-1).text, INVALID_EDIT_PRICE_MESSAGE);
    assert.equal(
      findInventoryItemByCode(database, inventory.inventoryCode).purchasePriceKrw,
      40000,
    );
    assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 99 });
  }));
}

test("/cancel clears pending edit and restores the original detail message", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  await handleTelegramUpdate(
    callback("edit_expected_sale_price", inventory.inventoryCode),
    dependencies(database, telegram, pending),
  );
  const result = await handleTelegramUpdate(
    message("/cancel"),
    dependencies(database, telegram, pending),
  );

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(pending.has(123), false);
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.deepEqual(telegram.deletions.at(-1), { chatId: 123, messageId: 99 });
  assert.equal(
    findInventoryItemByCode(database, inventory.inventoryCode).expectedSalePriceKrw,
    90000,
  );
}));

test("back from edit menu restores detail without creating pending state", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const telegram = recorder();
  const pending = createPendingInteractionStore();

  const result = await handleTelegramUpdate(
    callback("back", inventory.inventoryCode),
    dependencies(database, telegram, pending),
  );

  assert.equal(result.status, "updated");
  assert.equal(result.action, "back");
  assert.equal(pending.has(123), false);
  assert.equal(telegram.edits[0].messageId, 77);
}));
