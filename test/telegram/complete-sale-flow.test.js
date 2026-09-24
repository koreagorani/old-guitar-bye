import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { createAcquisition, updateAcquisitionState } from "../../src/repositories/acquisition-repository.js";
import { createInventoryItem, findInventoryItemByCode, updateInventoryState } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { createSaleListing, findSaleListingById } from "../../src/repositories/sale-listing-repository.js";
import { findSaleByInventoryItemId } from "../../src/repositories/sale-repository.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import {
  INVALID_SALE_PRICE_MESSAGE,
  SALE_CANCELLED_MESSAGE,
  SALE_FAILED_MESSAGE,
  SALE_INPUT_STEPS,
  SALE_MARKETPLACE_PROMPT,
  SALE_PRICE_PROMPT,
} from "../../src/telegram/interactions/complete-sale-flow.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "complete-sale-flow-"));
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

function createInventoryFixture(database, state = "FOR_SALE") {
  fixtureNumber += 1;
  const inventoryCode = `G-${String(fixtureNumber).padStart(4, "0")}`;
  const listing = saveOrUpdateListing(database, {
    marketplace: "daangn",
    externalListingId: `sale-flow-source-${fixtureNumber}`,
    url: `https://example.com/sale-flow-source-${fixtureNumber}`,
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
  if (state === "FOR_SALE") {
    inventory = updateInventoryState(database, inventory.id, "FOR_SALE");
  } else if (state === "REPAIRING") {
    inventory = updateInventoryState(database, inventory.id, "REPAIRING");
  }
  return inventory;
}

function telegramRecorder() {
  const messages = [];
  const edits = [];
  const answers = [];
  const deletions = [];
  return {
    messages,
    edits,
    answers,
    deletions,
    sendMessage: async (message) => messages.push(message),
    editMessage: async (message) => edits.push(message),
    answerCallback: async (answer) => answers.push(answer),
    deleteMessage: async (message) => deletions.push(message),
  };
}

function completeSaleCallback(inventoryCode, chatId = 123) {
  return {
    callback_query: {
      id: "complete-sale-callback",
      data: `inventory:complete_sale:${inventoryCode}`,
      message: { chat: { id: chatId }, message_id: 77 },
    },
  };
}

function saleListingCallback(saleListingId, chatId = 123) {
  return {
    callback_query: {
      id: `sale-listing-${saleListingId}`,
      data: `sale:listing:${saleListingId}`,
      message: { chat: { id: chatId }, message_id: 88 },
    },
  };
}

function message(text, chatId = 123) {
  return { message: { chat: { id: chatId }, message_id: 99, text } };
}

function dependencies(database, recorder, pendingInteractions) {
  return {
    database,
    sendMessage: recorder.sendMessage,
    editMessage: recorder.editMessage,
    answerCallback: recorder.answerCallback,
    deleteMessage: recorder.deleteMessage,
    allowedChatId: "123",
    pendingInteractions,
    now: () => new Date("2026-09-15T12:00:00Z"),
  };
}

async function begin(database, inventory, recorder, pendingInteractions) {
  return handleTelegramUpdate(
    completeSaleCallback(inventory.inventoryCode),
    dependencies(database, recorder, pendingInteractions),
  );
}

async function enterPrice(database, price, recorder, pendingInteractions) {
  return handleTelegramUpdate(
    message(price),
    dependencies(database, recorder, pendingInteractions),
  );
}

test("starts complete_sale for a FOR_SALE inventory item", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();

  const result = await begin(database, inventory, recorder, pending);

  assert.deepEqual(result, {
    status: "awaiting_sale_price",
    inventoryItemId: inventory.id,
  });
  assert.equal(recorder.edits[0].text, SALE_PRICE_PROMPT);
}));

test("stores an in-memory awaiting-price interaction", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();

  await begin(database, inventory, recorder, pending);

  assert.deepEqual(pending.get(123), {
    type: "complete_sale",
    step: SALE_INPUT_STEPS.PRICE,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    mainMessageId: 77,
  });
}));

test("one active SaleListing completes immediately after a valid price", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const saleListing = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 80000,
    listedAt: "2026-09-10T00:00:00Z",
  });
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);

  const result = await enterPrice(database, "75000", recorder, pending);

  const sale = findSaleByInventoryItemId(database, inventory.id);
  assert.equal(result.status, "sale_completed");
  assert.equal(sale.saleListingId, saleListing.id);
  assert.equal(sale.marketplace, "daangn");
  assert.equal(pending.has(123), false);
}));

test("one active SaleListing does not show marketplace selection", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 80000,
    listedAt: "2026-09-10T00:00:00Z",
  });
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);
  await enterPrice(database, "75000", recorder, pending);

  assert.equal(recorder.messages.some(({ text }) => text === SALE_MARKETPLACE_PROMPT), false);
}));

test("two active SaleListings ask only with their marketplaces", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const daangn = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 80000,
    listedAt: "2026-09-10T00:00:00Z",
  });
  const bunjang = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "bunjang",
    askingPriceKrw: 85000,
    listedAt: "2026-09-11T00:00:00Z",
  });
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);

  const result = await enterPrice(database, "75000", recorder, pending);

  assert.deepEqual(result, { status: "awaiting_sale_marketplace" });
  assert.equal(pending.get(123).step, SALE_INPUT_STEPS.MARKETPLACE);
  assert.deepEqual(pending.get(123).saleListingIds, [daangn.id, bunjang.id]);
  const prompt = recorder.edits.at(-1);
  assert.equal(prompt.text, SALE_MARKETPLACE_PROMPT);
  assert.deepEqual(prompt.replyMarkup.inline_keyboard.flat(), [
    { text: "당근", callback_data: `sale:listing:${daangn.id}` },
    { text: "번개장터", callback_data: `sale:listing:${bunjang.id}` },
  ]);
}));

test("duplicate marketplace listings are distinguished by asking price", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const first = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 80000,
    listedAt: "2026-09-10T00:00:00Z",
  });
  const second = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 90000,
    listedAt: "2026-09-11T00:00:00Z",
  });
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);
  await enterPrice(database, "75000", recorder, pending);

  assert.deepEqual(recorder.edits.at(-1).replyMarkup.inline_keyboard.flat(), [
    { text: "당근 (80,000원)", callback_data: `sale:listing:${first.id}` },
    { text: "당근 (90,000원)", callback_data: `sale:listing:${second.id}` },
  ]);
}));

test("text during marketplace selection repeats the actual listing choices", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const first = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 80000,
    listedAt: "2026-09-10T00:00:00Z",
  });
  const second = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "bunjang",
    askingPriceKrw: 85000,
    listedAt: "2026-09-11T00:00:00Z",
  });
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);
  await enterPrice(database, "75000", recorder, pending);

  const result = await enterPrice(database, "당근", recorder, pending);

  assert.deepEqual(result, { status: "awaiting_sale_marketplace" });
  assert.deepEqual(recorder.edits.at(-1).replyMarkup.inline_keyboard.flat(), [
    { text: "당근", callback_data: `sale:listing:${first.id}` },
    { text: "번개장터", callback_data: `sale:listing:${second.id}` },
  ]);
}));

for (const invalidPrice of ["-1", "가격", "1.5", "   "]) {
  test(`rejects invalid sale price: ${invalidPrice.trim() || "<blank>"}`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database);
    const recorder = telegramRecorder();
    const pending = createPendingInteractionStore();
    await begin(database, inventory, recorder, pending);

    const result = await enterPrice(database, invalidPrice, recorder, pending);

    assert.deepEqual(result, { status: "invalid_sale_price" });
    assert.equal(recorder.edits.at(-1).text, INVALID_SALE_PRICE_MESSAGE);
    assert.equal(pending.get(123).step, SALE_INPUT_STEPS.PRICE);
  }));
}

test("allows a zero sale price", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);

  await enterPrice(database, "0", recorder, pending);

  assert.equal(findSaleByInventoryItemId(database, inventory.id).salePriceKrw, 0);
}));

test("selecting one of multiple listings passes that exact listing to completeSale", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 80000,
    listedAt: "2026-09-10T00:00:00Z",
  });
  const saleListing = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "bunjang",
    askingPriceKrw: 85000,
    listedAt: "2026-09-11T00:00:00Z",
  });
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);
  await enterPrice(database, "75000", recorder, pending);

  const result = await handleTelegramUpdate(
    saleListingCallback(saleListing.id),
    dependencies(database, recorder, pending),
  );

  const sale = findSaleByInventoryItemId(database, inventory.id);
  assert.equal(result.status, "sale_completed");
  assert.equal(sale.salePriceKrw, 75000);
  assert.equal(sale.marketplace, "bunjang");
  assert.equal(sale.soldAt, "2026-09-15T12:00:00.000Z");
  assert.equal(sale.saleListingId, saleListing.id);
}));

test("completing a sale changes Inventory to SOLD and closes its listing", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const saleListing = createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "daangn",
    askingPriceKrw: 80000,
    listedAt: "2026-09-10T00:00:00Z",
  });
  createSaleListing(database, {
    inventoryItemId: inventory.id,
    marketplace: "bunjang",
    askingPriceKrw: 85000,
    listedAt: "2026-09-11T00:00:00Z",
  });
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);
  await enterPrice(database, "75000", recorder, pending);
  await handleTelegramUpdate(
    saleListingCallback(saleListing.id),
    dependencies(database, recorder, pending),
  );

  assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, "SOLD");
  assert.equal(
    findSaleListingById(database, saleListing.id).closedAt,
    "2026-09-15T12:00:00.000Z",
  );
}));

test("no active SaleListing completes immediately as a direct sale", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);
  const result = await enterPrice(database, "70000", recorder, pending);

  const sale = findSaleByInventoryItemId(database, inventory.id);
  assert.equal(result.status, "sale_completed");
  assert.equal(sale.marketplace, "direct");
  assert.equal(sale.saleListingId, null);
}));

test("refreshes the original detail without a separate success message", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);
  await enterPrice(database, "75000", recorder, pending);

  assert.deepEqual(recorder.messages, []);
  assert.equal(recorder.edits.at(-1).messageId, 77);
  assert.match(recorder.edits.at(-1).text, /상태: 판매 완료/);
  assert.match(recorder.edits.at(-1).text, /판매가: 75,000원/);
  assert.equal(pending.has(123), false);
}));

test("cancels and clears a pending sale with /cancel", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = telegramRecorder();
  const pending = createPendingInteractionStore();
  await begin(database, inventory, recorder, pending);

  const result = await handleTelegramUpdate(
    message("/cancel"),
    dependencies(database, recorder, pending),
  );

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(pending.has(123), false);
  assert.match(recorder.edits.at(-1).text, new RegExp(`🎸 ${inventory.inventoryCode}`));
  assert.deepEqual(recorder.deletions.at(-1), { chatId: 123, messageId: 99 });
}));

test("does not create pending state for an unauthorized user", async () => {
  const pending = createPendingInteractionStore();
  const database = new Proxy({}, {
    get() {
      throw new Error("database must not be accessed");
    },
  });

  const result = await handleTelegramUpdate(
    completeSaleCallback("G-0001", 999),
    {
      database,
      pendingInteractions: pending,
      allowedChatId: "123",
    },
  );

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(pending.has(999), false);
});

for (const state of ["IN_STOCK", "REPAIRING"]) {
  test(`does not start complete_sale from ${state}`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database, state);
    const recorder = telegramRecorder();
    const pending = createPendingInteractionStore();

    const result = await begin(database, inventory, recorder, pending);

    assert.equal(result.status, "invalid_state");
    assert.equal(recorder.answers[0].text, SALE_FAILED_MESSAGE);
    assert.equal(pending.has(123), false);
    assert.equal(findInventoryItemByCode(database, inventory.inventoryCode).state, state);
  }));
}
