import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { registerInventory } from "../../src/application/inventory/register-inventory.js";
import {
  archiveInventoryItem, restoreArchivedInventoryItem,
  listActiveInventoryItems, listArchivedInventoryItems,
  findInventoryItemById, updateInventoryState,
} from "../../src/repositories/inventory-repository.js";
import { renderInventoryList } from "../../src/telegram/render/inventory-list-renderer.js";
import { parseInventoryCallbackData } from "../../src/telegram/callbacks/inventory-callback-parser.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";

const makeItem = (i) => ({
  id: i + 1, inventoryCode: `G-${String(i + 1).padStart(4, "0")}`,
  brand: "Yamaha", modelName: `F${i}`, state: "IN_STOCK",
});
const callbacks = (markup) => markup.inline_keyboard.flat().filter((button) => button.callback_data);
for (const size of [0, 1, 5, 6, 20, 50]) {
  test(`inventory pagination boundaries for ${size} items`, () => {
    const items = Array.from({ length: size }, (_, i) => makeItem(i));
    const first = renderInventoryList(items);
    assert.equal(callbacks(first.replyMarkup).some((button) =>
      button.callback_data === "inventory:archived:0" || button.text === "제외된 재고"), false);
    const count = (first.text.match(/G-\d{4} ·/g) ?? []).length;
    assert.equal(count, Math.min(5, size));
    assert.equal(first.replyMarkup.inline_keyboard
      .filter((row) => row.some((button) => button.callback_data?.includes(":open:")))
      .every((row) => row.length <= 2), true);
    const totalPages = Math.max(1, Math.ceil(size / 5));
    const last = renderInventoryList(items, { page: 999 });
    if (size > 0) {
      assert.match(last.text, new RegExp(`${totalPages}/${totalPages} 페이지`));
      assert.equal((last.text.match(/G-\d{4} ·/g) ?? []).length, size % 5 || 5);
    }
    const lastActions = callbacks(last.replyMarkup);
    assert.equal(lastActions.some((b) => b.callback_data?.includes(":list:1000")), false);
    assert.equal(lastActions.some((b) => b.text === "다음 ▶"), false);
    if (size > 5) {
      assert.equal(callbacks(first.replyMarkup).some((b) => b.text === "다음 ▶"), true);
      assert.equal(lastActions.some((b) => b.text === "◀ 이전"), true);
    }
    for (const button of [...callbacks(first.replyMarkup), ...lastActions]) {
      assert.ok(Buffer.byteLength(button.callback_data, "utf8") <= 64);
      assert.doesNotThrow(() => parseInventoryCallbackData(button.callback_data));
    }
  });
}

async function withDatabase(fn) {
  const dir = mkdtempSync(join(tmpdir(), "inventory-archive-"));
  const database = openDatabase(join(dir, "data.sqlite"));
  try {
    applyMigrations(database);
    return await fn(database);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
let seq = 0;
function createItem(database) {
  seq += 1;
  return registerInventory(database, {
    brand: "Yamaha", modelName: `F${seq}`, guitarType: "ACOUSTIC",
    purchasePriceKrw: 37000, expectedSalePriceKrw: 90000,
    registeredAt: "2026-10-18T07:00:00Z",
  });
}
function io(database, pending = createPendingInteractionStore()) {
  const messages = [], edits = [], answers = [];
  return {
    messages, edits, answers,
    deps: {
      database, allowedChatId: "123", pendingInteractions: pending,
      sendMessage: async (x) => { messages.push(x); },
      editMessage: async (x) => { edits.push(x); },
      answerCallback: async (x) => { answers.push(x); },
    },
  };
}
const button = (data) => ({
  callback_query: {
    id: "callback", data, message: { chat: { id: 123 }, message_id: 77 },
  },
});
const command = (value) => ({
  message: { chat: { id: 123 }, message_id: 22, text: value },
});

test("pagination callbacks survive fresh interaction store and return to original page", async () =>
  withDatabase(async (db) => {
    const items = Array.from({ length: 6 }, () => createItem(db));
    const telegram = io(db);
    const first = await handleTelegramUpdate(command("/inventory"), telegram.deps);
    assert.equal(first.status, "listed");
    const next = telegram.messages[0].replyMarkup.inline_keyboard
      .flat().find((x) => x.text === "다음 ▶");
    assert.equal(next.callback_data, "inventory:list:1");
    const restarted = io(db); // fresh bot memory, same DB and callback
    await handleTelegramUpdate(button(next.callback_data), restarted.deps);
    assert.match(restarted.edits.at(-1).text, /2\/2 페이지/);
    const open = restarted.edits.at(-1).replyMarkup.inline_keyboard
      .flat().find((x) => x.callback_data?.startsWith("inventory:open:"));
    await handleTelegramUpdate(button(open.callback_data), restarted.deps);
    const back = restarted.edits.at(-1).replyMarkup.inline_keyboard
      .flat().find((x) => x.text === "목록으로");
    assert.equal(back.callback_data, "inventory:list:1");
    await handleTelegramUpdate(button(back.callback_data), restarted.deps);
    assert.match(restarted.edits.at(-1).text, /2\/2 페이지/);
    assert.equal(items.length, 6);
  }));

test("archive requires confirmation, preserves repair/expenses/sales/price, and restores same id", async () =>
  withDatabase(async (db) => {
    let item = createItem(db);
    const original = { ...item };
    db.prepare("INSERT INTO repair_logs (inventory_item_id,type,cost_krw,performed_at) VALUES (?,?,?,?)")
      .run(item.id, "OTHER", 9000, "2026-10-18T08:00:00Z");
    db.prepare("INSERT INTO expenses (inventory_item_id,category,amount_krw,occurred_at) VALUES (?,?,?,?)")
      .run(item.id, "LOGISTICS", 3000, "2026-10-18T08:30:00Z");

    item = updateInventoryState(db,item.id,"FOR_SALE");
    item = updateInventoryState(db,item.id,"SOLD");
    db.prepare("INSERT INTO sales (inventory_item_id,sale_price_krw,sold_at,marketplace) VALUES (?,?,?,?)")
      .run(item.id, 120000, "2026-10-18T09:00:00Z", "direct");

    const telegram = io(db);
    const archiveConfirm = `inventory:archive_confirm:${item.inventoryCode}`;
    const archiveDo = `inventory:archive_do:${item.inventoryCode}`;
    let result = await handleTelegramUpdate(button(archiveDo),telegram.deps);
    assert.equal(result.status, "invalid_confirmation");
    assert.equal(findInventoryItemById(db,item.id).archivedAt,null);
    result = await handleTelegramUpdate(button(archiveConfirm),telegram.deps);
    assert.equal(result.status,"awaiting_confirmation");
    assert.equal(findInventoryItemById(db,item.id).archivedAt,null);
    result = await handleTelegramUpdate(button(archiveDo),telegram.deps);
    assert.equal(result.status,"archived");
    assert.equal(findInventoryItemById(db,item.id).state,"SOLD");
    assert.equal(findInventoryItemById(db,item.id).purchasePriceKrw,original.purchasePriceKrw);
    assert.equal(listActiveInventoryItems(db).length,0);
    assert.equal(listArchivedInventoryItems(db).length,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM repair_logs WHERE inventory_item_id = ?").get(item.id).n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM expenses WHERE inventory_item_id = ?").get(item.id).n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sales WHERE inventory_item_id = ?").get(item.id).n,1);
    const duplicate = await handleTelegramUpdate(button(archiveDo),telegram.deps);
    assert.notEqual(duplicate.status,"archived");
    // The archive list callback remains supported internally but is not shown on /inventory.
    await handleTelegramUpdate(command("/inventory"), telegram.deps);
    assert.deepEqual(telegram.messages.at(-1).replyMarkup.inline_keyboard, []);
    await handleTelegramUpdate(button("inventory:archived:0"), telegram.deps);
    const archiveOpen = telegram.edits.at(-1).replyMarkup.inline_keyboard
      .flat().find((x) => x.callback_data?.startsWith("inventory:open_archived:"));
    await handleTelegramUpdate(button(archiveOpen.callback_data), telegram.deps);
    assert.match(telegram.edits.at(-1).text,/제외된 재고/);
    const restoreConfirm = `inventory:restore_confirm:${item.inventoryCode}:p0`;
    const restoreDo = `inventory:restore_do:${item.inventoryCode}:p0`;
    await handleTelegramUpdate(button(restoreConfirm), telegram.deps);
    result = await handleTelegramUpdate(button(restoreDo), telegram.deps);
    assert.equal(result.status,"restored");
    assert.equal(findInventoryItemById(db,item.id).archivedAt,null);
    assert.equal(findInventoryItemById(db,item.id).id,item.id);
    assert.equal(findInventoryItemById(db,item.id).state,"SOLD");
    assert.equal(listArchivedInventoryItems(db).length,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_items").get().n,1);
  }));

test("open sale listings block archiving until closed, preserve FK rows",async () =>
  withDatabase(async (db) => {
    const item = createItem(db);
    db.prepare("INSERT INTO sale_listings (inventory_item_id,marketplace,asking_price_krw,listed_at) VALUES (?,?,?,?)")
      .run(item.id,"bunjang",100000,"2026-10-18T09:00:00Z");
    const refused = archiveInventoryItem(db,item.id);
    assert.equal(refused.status,"open_sale_listings");
    assert.equal(refused.inventory.archivedAt,null);
    db.prepare("UPDATE sale_listings SET closed_at = ? WHERE inventory_item_id = ?")
      .run("2026-10-18T10:00:00Z",item.id);
    const archived = archiveInventoryItem(db,item.id);
    assert.equal(archived.status,"archived");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sale_listings WHERE inventory_item_id = ?").get(item.id).n,1);
    assert.equal(archiveInventoryItem(db,item.id).status,"already_archived");
    assert.equal(restoreArchivedInventoryItem(db,item.id).status,"restored");
    assert.equal(restoreArchivedInventoryItem(db,item.id).status,"already_active");
  }));

test("archive screens and pagination reject unauthorized chat",async () =>
  withDatabase(async db=>{
    const item=createItem(db),rec=io(db);
    const result=await handleTelegramUpdate({
      callback_query:{id:"denied",data:`inventory:archive_confirm:${item.inventoryCode}`,
        message:{chat:{id:999},message_id:77}},
    },rec.deps);
    assert.deepEqual(result,{status:"ignored"});
    assert.equal(rec.edits.length,0);
    assert.equal(findInventoryItemById(db,item.id).archivedAt,null);
  }));

test("out-of-range callback page is clamped, unsafe page is rejected", () => {
  assert.deepEqual(parseInventoryCallbackData("inventory:list:99"), {
    entity:"inventory", action:"list", inventoryCode:null, page:99,
  });
  assert.equal(renderInventoryList([makeItem(0)],{page:99}).text.includes("1/1 페이지"),true);
  assert.throws(
    () => parseInventoryCallbackData("inventory:list:99999999999999999999999"),
    /Invalid inventory callback page/,
  );
  assert.throws(
    () => parseInventoryCallbackData("inventory:open:G-0001:p99999999999999999999999"),
    /Invalid inventory callback page/,
  );
});
