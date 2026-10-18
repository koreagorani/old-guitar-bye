import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { registerInventory } from "../../src/application/inventory/register-inventory.js";
import { updateInventoryState, archiveInventoryItem } from "../../src/repositories/inventory-repository.js";
import { completeSale } from "../../src/application/sales/complete-sale.js";
import { cancelSale } from "../../src/application/sales/cancel-sale.js";
import { listSalesPage, getSaleDetail } from "../../src/application/sales/query-sales.js";
import { handleTelegramUpdate } from "../../src/telegram/bot.js";
import { renderSalesPage } from "../../src/telegram/interactions/sales-query-flow.js";

let serial=0;
async function withDb(fn) {
  const dir=mkdtempSync(join(tmpdir(),"sales-list-")),db=openDatabase(join(dir,"test.sqlite"));
  try {applyMigrations(db);return await fn(db);}
  finally {db.close();rmSync(dir,{recursive:true,force:true});}
}
function make(db,{date="2026-10-18T09:00:00Z",price=65000}={}) {
  serial+=1;
  let item=registerInventory(db,{brand:"Yamaha",modelName:`F${serial}`,
    guitarType:"ACOUSTIC",purchasePriceKrw:40000,registeredAt:"2026-10-15T00:00:00Z",expectedSalePriceKrw:null});
  item=updateInventoryState(db,item.id,"FOR_SALE");
  const sale=completeSale(db,{inventoryItemId:item.id,salePriceKrw:price,
    soldAt:date,marketplace:"bunjang"});
  return {...sale.sale,inventory:item};
}
function mock(db) {
  const sent=[],edited=[],acked=[];
  return {sent,edited,acked,deps:{database:db,allowedChatId:"123",
    sendMessage:async x=>sent.push(x),editMessage:async x=>edited.push(x),
    answerCallback:async x=>acked.push(x)}};
}
const cmd=()=>({message:{chat:{id:123},text:"/sales"}});
const cb=(data,chat=123)=>({callback_query:{id:"cb1",data,message:{chat:{id:chat},message_id:77}}});

for(const count of [0,1,5,6,20,50]) {
  test(`/sales paginates ${count} records`,()=>withDb(async db=>{
    for(let i=0;i<count;i++)make(db);
    const io=mock(db),result=await handleTelegramUpdate(cmd(),io.deps);
    assert.equal(result.count,count);
    const expected=count===0?"판매 완료된 기타가 없습니다.":`전체 ${count}건`;
    assert.ok(io.sent[0].text.includes(expected));
    const buttons=io.sent[0].replyMarkup.inline_keyboard;
    assert.ok(buttons.filter(row=>row.some(b=>b.callback_data.startsWith("sales:open:")))
      .every(row=>row.length<=2));
    assert.equal(buttons.flat().filter(b=>b.callback_data.startsWith("sales:open:")).length,Math.min(count,5));
    for(const button of buttons.flat()) assert.ok(Buffer.byteLength(button.callback_data,"utf8")<=64);
    const pages=Math.max(1,Math.ceil(count/5));
    const last=listSalesPage(db,{page:999});
    assert.equal(last.page,pages-1);
    assert.equal(renderSalesPage(last).replyMarkup.inline_keyboard.flat().some(x=>x.text==="다음 ▶"),false);
    if(count>5){
      await handleTelegramUpdate(cb("sales:list:1"),io.deps);
      assert.match(io.edited.at(-1).text,/2\//);
      const open=io.edited.at(-1).replyMarkup.inline_keyboard.flat().find(x=>x.callback_data.startsWith("sales:open:"));
      await handleTelegramUpdate(cb(open.callback_data),io.deps);
      assert.match(io.edited.at(-1).text,/판매 상세/);
      assert.equal(io.edited.at(-1).replyMarkup.inline_keyboard[0][0].callback_data,"sales:list:1");
    }
  }));
}
test("sort by recent soldAt and saleId descending",()=>withDb(async db=>{
  const older=make(db,{date:"2026-01-01T00:00:00Z"});
  const newer=make(db,{date:"2026-10-18T00:00:00Z"});
  const tied=make(db,{date:"2026-10-18T00:00:00Z"});
  assert.deepEqual(listSalesPage(db).rows.map(x=>x.saleId),[tied.id,newer.id,older.id]);
}));
test("sales details use recorded repair and expense costs including negative profit",()=>withDb(async db=>{
  const sold=make(db,{price:30000});
  db.prepare("INSERT INTO repair_logs (inventory_item_id,type,cost_krw,performed_at) VALUES (?, ?, ?, ?)")
    .run(sold.inventory.id,"OTHER",5000,"2026-10-17T00:00:00Z");
  db.prepare("INSERT INTO expenses (inventory_item_id,category,amount_krw,occurred_at) VALUES (?, ?, ?, ?)")
    .run(sold.inventory.id,"LOGISTICS",2000,"2026-10-17T00:00:00Z");
  const io=mock(db);
  await handleTelegramUpdate(cb(`sales:open:${sold.id}:0`),io.deps);
  const text=io.edited.at(-1).text;
  for(const part of ["30,000원","40,000원","5,000원","2,000원","47,000원","-17,000원","번개장터"])
    assert.ok(text.includes(part),part);
  assert.equal(getSaleDetail(db,sold.id).cost.totalCostKrw,47000);
}));
test("cancellation hides sale without deleting history; archive of SOLD remains visible",()=>withDb(async db=>{
  const cancelled=make(db);
  const retained=make(db);
  cancelSale(db,cancelled.inventory.id);
  archiveInventoryItem(db,retained.inventory.id);
  assert.equal(listSalesPage(db).total,1);
  assert.equal(listSalesPage(db).rows[0].saleId,retained.id);
  assert.equal(getSaleDetail(db,cancelled.id),null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sales").get().n,2);
  const io=mock(db);
  await handleTelegramUpdate(cb(`sales:open:${cancelled.id}:0`),io.deps);
  assert.equal(io.edited.at(-1).text.includes("전체 1건"),true);
  assert.ok(io.acked.at(-1).text.includes("취소"));
}));
test("list page clamps after sale cancellation, invalid callback safe",()=>withDb(async db=>{
  const sales=Array.from({length:6},()=>make(db));
  cancelSale(db,sales[5].inventory.id);
  const io=mock(db);
  await handleTelegramUpdate(cb("sales:list:999"),io.deps);
  assert.match(io.edited.at(-1).text,/1\/1 페이지/);
  assert.equal((await handleTelegramUpdate(cb("sales:list:99999999999999999999"),io.deps)).status,"invalid");
}));
test("chat authorization blocks sales views and callbacks",()=>withDb(async db=>{
  const io=mock(db);
  assert.deepEqual(await handleTelegramUpdate({message:{chat:{id:999},text:"/sales"}},io.deps),{status:"ignored"});
  assert.deepEqual(await handleTelegramUpdate(cb("sales:list:0",999),io.deps),{status:"ignored"});
  assert.deepEqual(io.sent,[]);
  assert.deepEqual(io.edited,[]);
}));
test("existing sales with state restored to FOR_SALE cannot be sold again under unique constraint",()=>withDb(async db=>{
 const sold=make(db);cancelSale(db,sold.inventory.id);
 assert.throws(()=>completeSale(db,{inventoryItemId:sold.inventory.id,marketplace:"direct",
   salePriceKrw:90000,soldAt:"2026-10-19T00:00:00Z"}),/UNIQUE constraint failed/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sales").get().n,1);
}));
