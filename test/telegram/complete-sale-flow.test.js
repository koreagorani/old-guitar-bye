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


function cb(data,chatId=123){return {callback_query:{id:"x",data,message:{chat:{id:chatId},message_id:77}}};}
const run=(db,event,rec,pending)=>handleTelegramUpdate(event,dependencies(db,rec,pending));
async function start(db,item,rec,pending){return run(db,completeSaleCallback(item.inventoryCode),rec,pending);}
async function price(db,value,rec,pending){return run(db,message(value),rec,pending);}
async function market(db,item,place,rec,pending){
  return run(db,cb(`sale:market:${place}:${item.inventoryCode}`),rec,pending);
}
async function confirm(db,item,rec,pending){
  return run(db,cb(`sale:confirm:${item.inventoryCode}`),rec,pending);
}
test("sale menu IN_STOCK has selling and completion; FOR_SALE completion only",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db,"IN_STOCK"),rec=telegramRecorder(),pending=createPendingInteractionStore();
 await run(db,cb(`inventory:sale:${item.inventoryCode}`),rec,pending);
 assert.match(rec.edits.at(-1).text,/판매 처리 메뉴/);
 assert.deepEqual(rec.edits.at(-1).replyMarkup.inline_keyboard.flat().map(x=>x.text),["판매 중으로 변경","판매 완료","뒤로"]);
 await run(db,cb(`inventory:mark_for_sale:${item.inventoryCode}`),rec,pending);
 assert.equal(findInventoryItemByCode(db,item.inventoryCode).state,"FOR_SALE");
 await run(db,cb(`inventory:sale:${item.inventoryCode}`),rec,pending);
 assert.deepEqual(rec.edits.at(-1).replyMarkup.inline_keyboard.flat().map(x=>x.text),["판매 완료","뒤로"]);
}));
test("REPAIRING menu blocks completion",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db,"REPAIRING"),rec=telegramRecorder(),pending=createPendingInteractionStore();
 await run(db,cb(`inventory:sale:${item.inventoryCode}`),rec,pending);
 assert.match(rec.edits.at(-1).text,/수리 완료/);
 const result=await start(db,item,rec,pending);
 assert.equal(result.status,"invalid_state");
 assert.equal(findSaleByInventoryItemId(db,item.id),null);
}));
test("price and marketplace do not mutate database before confirmation",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db,"IN_STOCK"),rec=telegramRecorder(),pending=createPendingInteractionStore();
 await start(db,item,rec,pending);
 assert.equal(pending.get(123).step,SALE_INPUT_STEPS.PRICE);
 assert.equal((await price(db,"invalid",rec,pending)).status,"invalid_sale_price");
 assert.equal((await price(db,"75000",rec,pending)).status,"awaiting_sale_marketplace");
 assert.equal(rec.edits.at(-1).replyMarkup.inline_keyboard.flat().filter(x=>x.callback_data.startsWith("sale:market:")).length,5);
 assert.equal(findSaleByInventoryItemId(db,item.id),null);
 assert.equal(findInventoryItemByCode(db,item.inventoryCode).state,"IN_STOCK");
 await market(db,item,"bunjang",rec,pending);
 assert.match(rec.edits.at(-1).text,/판매 최종 확인/);
 assert.match(rec.edits.at(-1).text,/매입원가: 40,000원/);
 assert.match(rec.edits.at(-1).text,/예상 실현손익: 35,000원/);
 assert.match(rec.edits.at(-1).text,/수수료·배송비/);
 assert.equal(findSaleByInventoryItemId(db,item.id),null);
 assert.equal(findInventoryItemByCode(db,item.inventoryCode).state,"IN_STOCK");
 const done=await confirm(db,item,rec,pending);
 assert.equal(done.status,"sale_completed");
 assert.equal(findInventoryItemByCode(db,item.inventoryCode).state,"SOLD");
 assert.equal(findSaleByInventoryItemId(db,item.id).marketplace,"bunjang");
 assert.equal(findSaleByInventoryItemId(db,item.id).salePriceKrw,75000);
 assert.equal(rec.messages.length,0);
 assert.equal((await confirm(db,item,rec,pending)).status,"invalid_sale_confirmation");
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sales WHERE inventory_item_id=?").get(item.id).n,1);
}));
test("without listing seller still selects marketplace",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db),rec=telegramRecorder(),pending=createPendingInteractionStore();
 await start(db,item,rec,pending);await price(db,"0",rec,pending);
 assert.equal(rec.edits.at(-1).text,SALE_MARKETPLACE_PROMPT);
 await market(db,item,"other",rec,pending);await confirm(db,item,rec,pending);
 assert.equal(findSaleByInventoryItemId(db,item.id).marketplace,"other");
 assert.equal(findSaleByInventoryItemId(db,item.id).salePriceKrw,0);
}));
test("matched listing selected by stable id and other listings closed",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db),l1=createSaleListing(db,{inventoryItemId:item.id,marketplace:"bunjang",askingPriceKrw:70000,listedAt:"2026-09-10T00:00:00Z"});
 const l2=createSaleListing(db,{inventoryItemId:item.id,marketplace:"bunjang",askingPriceKrw:80000,listedAt:"2026-09-11T00:00:00Z"});
 const rec=telegramRecorder(),pending=createPendingInteractionStore();
 await start(db,item,rec,pending);await price(db,"85000",rec,pending);await market(db,item,"bunjang",rec,pending);await confirm(db,item,rec,pending);
 assert.equal(findSaleByInventoryItemId(db,item.id).saleListingId,l1.id);
 assert.ok(findSaleListingById(db,l1.id).closedAt);
 assert.ok(findSaleListingById(db,l2.id).closedAt);
}));
test("cancel button and /cancel discard pending sale",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db),rec=telegramRecorder(),pending=createPendingInteractionStore();
 await start(db,item,rec,pending);
 await run(db,cb(`sale:cancel:${item.inventoryCode}`),rec,pending);
 assert.equal(pending.has(123),false);
 await start(db,item,rec,pending);
 await run(db,message("/cancel"),rec,pending);
 assert.equal(pending.has(123),false);
 assert.equal(findSaleByInventoryItemId(db,item.id),null);
}));
test("restart prevents stale confirmation and unauthorized chat is ignored",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db),rec=telegramRecorder(),pending=createPendingInteractionStore();
 await start(db,item,rec,pending);await price(db,"75000",rec,pending);await market(db,item,"direct",rec,pending);
 const restarted=createPendingInteractionStore();
 assert.equal((await confirm(db,item,rec,restarted)).status,"invalid_sale_confirmation");
 assert.deepEqual(await run(db,cb(`sale:confirm:${item.inventoryCode}`,999),rec,restarted),{status:"ignored"});
 assert.equal(findSaleByInventoryItemId(db,item.id),null);
}));
test("SOLD sale button shows information without creating another sale",()=>withDatabase(async db=>{
 const item=createInventoryFixture(db),rec=telegramRecorder(),pending=createPendingInteractionStore();
 await start(db,item,rec,pending);await price(db,"75000",rec,pending);await market(db,item,"direct",rec,pending);await confirm(db,item,rec,pending);
 await run(db,cb(`inventory:sale:${item.inventoryCode}`),rec,pending);
 assert.match(rec.edits.at(-1).text,/이미 판매 완료/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sales WHERE inventory_item_id=?").get(item.id).n,1);
}));
