import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { getInventoryDetail } from "../../src/application/inventory/get-inventory-detail.js";
import {
  handleTelegramUpdate,
  START_MESSAGE,
} from "../../src/telegram/bot.js";
import {
  createAcquisition,
  updateAcquisitionState,
} from "../../src/repositories/acquisition-repository.js";
import { createInventoryItem } from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import {
  handleInventoryCommand,
  INVENTORY_NOT_FOUND_MESSAGE,
  INVENTORY_USAGE_MESSAGE,
  parseInventoryCommand,
} from "../../src/telegram/commands/inventory-command.js";
import { renderInventoryDetail } from "../../src/telegram/render/inventory-detail-renderer.js";
import { sendTelegramMessage } from "../../src/telegram/telegram-client.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "inventory-command-"));
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
    externalListingId: `telegram-source-${fixtureNumber}`,
    url: `https://example.com/telegram-source-${fixtureNumber}`,
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
  return createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-03T00:00:00Z",
    expectedSalePriceKrw: 90000,
  });
}

function messageRecorder() {
  const messages = [];
  return {
    messages,
    sendMessage: async (message) => {
      messages.push(message);
      return { message_id: messages.length };
    },
  };
}

test("responds to /start with a short Korean introduction", async () => {
  const recorder = messageRecorder();
  const result = await handleTelegramUpdate(
    { message: { chat: { id: 123 }, text: "/start" } },
    {
      database: null,
      sendMessage: recorder.sendMessage,
      allowedChatId: "123",
    },
  );

  assert.deepEqual(result, { status: "started" });
  assert.deepEqual(recorder.messages, [
    { chatId: 123, text: START_MESSAGE },
  ]);
});

test("parses /inventory with an inventory code", () => {
  assert.equal(parseInventoryCommand("/inventory G-0003"), "G-0003");
  assert.equal(parseInventoryCommand("/inventory@old_guitar_bot G-0003"), "G-0003");
});

test("routes /inventory updates through the bot entry point", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = messageRecorder();
  const result = await handleTelegramUpdate(
    {
      message: {
        chat: { id: 123 },
        text: `/inventory ${inventory.inventoryCode}`,
      },
    },
    {
      database,
      sendMessage: recorder.sendMessage,
      allowedChatId: "123",
    },
  );

  assert.deepEqual(result, { status: "found", inventoryItemId: inventory.id });
  assert.match(recorder.messages[0].text, new RegExp(inventory.inventoryCode));
}));

test("finds and sends an existing inventory item", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = messageRecorder();
  const result = await handleInventoryCommand({
    database,
    chatId: 123,
    commandText: `/inventory ${inventory.inventoryCode}`,
    sendMessage: recorder.sendMessage,
  });

  assert.deepEqual(result, { status: "found", inventoryItemId: inventory.id });
  assert.equal(recorder.messages.length, 1);
  assert.match(recorder.messages[0].text, new RegExp(inventory.inventoryCode));
}));

test("reports when an inventory item does not exist", async () => withDatabase(async (database) => {
  const recorder = messageRecorder();
  const result = await handleInventoryCommand({
    database,
    chatId: 123,
    commandText: "/inventory G-9999",
    sendMessage: recorder.sendMessage,
  });

  assert.deepEqual(result, { status: "not_found", inventoryCode: "G-9999" });
  assert.equal(recorder.messages[0].text, INVENTORY_NOT_FOUND_MESSAGE);
}));

test("uses InventoryDetailRenderer output", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = messageRecorder();
  await handleInventoryCommand({
    database,
    chatId: 123,
    commandText: `/inventory ${inventory.inventoryCode}`,
    sendMessage: recorder.sendMessage,
  });

  assert.equal(
    recorder.messages[0].text,
    renderInventoryDetail(getInventoryDetail(database, inventory.id)),
  );
}));

test("includes state-specific and common buttons", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = messageRecorder();
  await handleInventoryCommand({
    database,
    chatId: 123,
    commandText: `/inventory ${inventory.inventoryCode}`,
    sendMessage: recorder.sendMessage,
  });

  const buttons = recorder.messages[0].replyMarkup.inline_keyboard.flat();
  assert.deepEqual(buttons.map(({ text }) => text), [
    "수리 시작",
    "바로 판매",
    "수리 기록 추가",
    "비용 추가",
  ]);
}));

test("keeps every Telegram button label in Korean", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = messageRecorder();
  await handleInventoryCommand({
    database,
    chatId: 123,
    commandText: `/inventory ${inventory.inventoryCode}`,
    sendMessage: recorder.sendMessage,
  });

  for (const button of recorder.messages[0].replyMarkup.inline_keyboard.flat()) {
    assert.match(button.text, /[가-힣]/);
  }
}));

test("uses English action ids in callback data", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database);
  const recorder = messageRecorder();
  await handleInventoryCommand({
    database,
    chatId: 123,
    commandText: `/inventory ${inventory.inventoryCode}`,
    sendMessage: recorder.sendMessage,
  });

  const callbackData = recorder.messages[0].replyMarkup.inline_keyboard
    .flat()
    .map(({ callback_data: value }) => value);
  assert.ok(callbackData.includes(
    `inventory:start_repair:${inventory.inventoryCode}`,
  ));
  assert.ok(callbackData.every((value) => (
    /^inventory:[a-z]+(?:_[a-z]+)*:G-\d{4}$/.test(value)
  )));
}));

for (const commandText of ["/inventory G-0003 extra", null]) {
  test(`handles invalid inventory command ${String(commandText)}`, async () => withDatabase(async (database) => {
    const recorder = messageRecorder();
    const result = await handleInventoryCommand({
      database,
      chatId: 123,
      commandText,
      sendMessage: recorder.sendMessage,
    });

    assert.deepEqual(result, { status: "invalid" });
    assert.equal(recorder.messages[0].text, INVENTORY_USAGE_MESSAGE);
  }));
}

test("uses an injected fetch instead of calling the real Telegram API", async () => {
  const requests = [];
  const result = await sendTelegramMessage({
    token: "test-token",
    chatId: 123,
    text: "테스트",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 7 } }),
      };
    },
  });

  assert.deepEqual(result, { message_id: 7 });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.telegram.org/bottest-token/sendMessage",
  );
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    chat_id: 123,
    text: "테스트",
  });
});
