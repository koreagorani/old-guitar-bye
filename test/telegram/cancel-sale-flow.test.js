import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { completeSale } from "../../src/application/sales/complete-sale.js";
import {
  createAcquisition,
  updateAcquisitionState,
} from "../../src/repositories/acquisition-repository.js";
import {
  createInventoryItem,
  findInventoryItemByCode,
  updateInventoryState,
} from "../../src/repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";
import { findSaleByInventoryItemId } from "../../src/repositories/sale-repository.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";
import { INVALID_STATE_MESSAGE } from "../../src/telegram/callbacks/inventory-callback-handler.js";

async function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "cancel-sale-flow-"));
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
    externalListingId: `cancel-sale-${fixtureNumber}`,
    url: `https://example.com/cancel-sale-${fixtureNumber}`,
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
  let inventory = createInventoryItem(database, {
    acquisitionId: acquisition.id,
    inventoryCode,
    brand: "Yamaha",
    modelName: "F310",
    guitarType: "ACOUSTIC",
    purchasePriceKrw: 40000,
    receivedAt: "2026-09-25T02:00:00Z",
    expectedSalePriceKrw: 90000,
  });

  if (state === "FOR_SALE" || state === "SOLD") {
    inventory = updateInventoryState(database, inventory.id, "FOR_SALE");
  }
  if (state === "SOLD") {
    inventory = completeSale(database, {
      inventoryItemId: inventory.id,
      saleListingId: null,
      marketplace: "direct",
      salePriceKrw: 80000,
      soldAt: "2026-09-25T03:00:00Z",
      note: null,
    }).inventoryItem;
  }
  return inventory;
}

function recorder() {
  const edits = [];
  const answers = [];
  return {
    edits,
    answers,
    editMessage: async (value) => edits.push(value),
    answerCallback: async (value) => answers.push(value),
    deleteMessage: async () => {},
    sendMessage: async () => {},
  };
}

function dependencies(database, telegram) {
  return {
    database,
    pendingInteractions: createPendingInteractionStore(),
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

test("shows sale cancellation only in the SOLD edit menu", async () => withDatabase(async (database) => {
  const sold = createInventoryFixture(database, "SOLD");
  const soldTelegram = recorder();
  await handleTelegramUpdate(
    callback("edit", sold.inventoryCode),
    dependencies(database, soldTelegram),
  );
  assert.deepEqual(
    soldTelegram.edits[0].replyMarkup.inline_keyboard.map(
      (row) => row.map(({ text }) => text),
    ),
    [["매입가 수정", "예상 판매가 수정"], ["판매 취소"], ["뒤로"]],
  );

  const forSale = createInventoryFixture(database, "FOR_SALE");
  const activeTelegram = recorder();
  await handleTelegramUpdate(
    callback("edit", forSale.inventoryCode),
    dependencies(database, activeTelegram),
  );
  assert.equal(
    activeTelegram.edits[0].replyMarkup.inline_keyboard
      .flat()
      .some(({ text }) => text === "판매 취소"),
    false,
  );
}));

test("sale cancellation restores FOR_SALE and preserves the sale record", async () => withDatabase(async (database) => {
  const inventory = createInventoryFixture(database, "SOLD");
  const saleBefore = findSaleByInventoryItemId(database, inventory.id);
  const telegram = recorder();

  const result = await handleTelegramUpdate(
    callback("cancel_sale", inventory.inventoryCode),
    dependencies(database, telegram),
  );

  assert.deepEqual(result, {
    status: "updated",
    action: "cancel_sale",
    inventoryItemId: inventory.id,
  });
  assert.equal(
    findInventoryItemByCode(database, inventory.inventoryCode).state,
    "FOR_SALE",
  );
  assert.equal(telegram.edits.at(-1).messageId, 77);
  assert.match(telegram.edits.at(-1).text, /상태: 판매 가능/);
  assert.equal(
    telegram.answers.at(-1).text,
    "판매를 취소하고 판매 가능 상태로 복구했습니다.",
  );
  assert.deepEqual(findSaleByInventoryItemId(database, inventory.id), saleBefore);
}));

for (const state of ["IN_STOCK", "FOR_SALE"]) {
  test(`rejects sale cancellation from ${state}`, async () => withDatabase(async (database) => {
    const inventory = createInventoryFixture(database, state);
    const telegram = recorder();

    const result = await handleTelegramUpdate(
      callback("cancel_sale", inventory.inventoryCode),
      dependencies(database, telegram),
    );

    assert.deepEqual(result, {
      status: "invalid_state",
      action: "cancel_sale",
      inventoryCode: inventory.inventoryCode,
    });
    assert.equal(
      findInventoryItemByCode(database, inventory.inventoryCode).state,
      state,
    );
    assert.equal(telegram.answers.at(-1).text, INVALID_STATE_MESSAGE);
    assert.equal(telegram.edits.length, 0);
  }));
}
