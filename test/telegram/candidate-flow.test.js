import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMigrations,openDatabase } from "../../scripts/migrate.js";
import { registerTrackCandidates,findCandidateById } from "../../src/repositories/opportunity-candidate-repository.js";
import { createPendingInteractionStore } from "../../src/telegram/interactions/pending-interaction-store.js";
import { handleCandidatesCommand,handleCandidateCallback,handlePendingCandidatePurchase,renderCandidatePage } from "../../src/telegram/interactions/candidate-flow.js";

async function dbRun(fn){
 const dir=mkdtempSync(join(tmpdir(),"candidate-telegram-")),db=openDatabase(join(dir,"tmp.db"));
 try{applyMigrations(db);return await fn(db)}finally{db.close();rmSync(dir,{recursive:true,force:true})}
}
function seed(db,count=1){
 const ops=[];
 for(let i=0;i<count;i++){
  const id=String(700000+i),title=`YAMAHA F310 ${id}`,url=`https://m.bunjang.co.kr/products/${id}`;
  db.prepare("INSERT INTO listings (marketplace,external_listing_id,url,title,description,asking_price_krw,discovered_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)").run("BUNJANG",id,url,title,"",20000,"2026-10-18T00:00:00Z","2026-10-18T00:00:00Z");
  ops.push({marketplace:"BUNJANG",externalListingId:id,brand:"YAMAHA",model:"F310",guitarType:"ACOUSTIC",identityConfidence:"HIGH",referenceNewPriceKrw:195000,ratioPct:i+1,decision:"TRACK"});
 }
 return registerTrackCandidates(db,ops).candidates;
}
function transport(){
 const sent=[],edited=[],acks=[],cleaned=[];
 return {
  sent,edited,acks,cleaned,
  sendMessage:async x=>{sent.push(x);return {message_id:20}},
  editMessage:async x=>{edited.push(x)},
  answerCallback:async x=>{acks.push(x)},
  cleanupMessage:async x=>{cleaned.push(x)},
 };
}
const cb=(value)=>({data:value,id:"cb",message:{chat:{id:42},message_id:20}});
const message=(text)=>({text,message_id:99,chat:{id:42}});

test("/candidates lists active only and paginates via callbacks",()=>dbRun(async db=>{
 seed(db,11);
 const io=transport(), pending=createPendingInteractionStore();
 await handleCandidatesCommand({database:db,chatId:42,sendMessage:io.sendMessage});
 assert.match(io.sent[0].text,/11건/);
 assert.match(io.sent[0].replyMarkup.inline_keyboard.at(-1)[0].callback_data,/cand:list:1/);
 await handleCandidateCallback({database:db,callbackQuery:cb("cand:list:1"),pendingInteractions:pending,editMessage:io.editMessage,answerCallback:io.answerCallback});
 assert.match(io.edited.at(-1).text,/2\/3 페이지/);
}));

test("purchase must have actual paid price and explicit final confirmation",()=>dbRun(async db=>{
 const [candidate]=seed(db), io=transport(), pending=createPendingInteractionStore();
 await handleCandidateCallback({database:db,callbackQuery:cb(`cand:buy:${candidate.id}:0`),pendingInteractions:pending,editMessage:io.editMessage,answerCallback:io.answerCallback});
 assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_items").get().n,0);
 const bad=await handlePendingCandidatePurchase({database:db,message:message("xx"),pendingInteractions:pending,editMessage:io.editMessage,cleanupMessage:io.cleanupMessage});
 assert.equal(bad.status,"invalid_price");
 const price=await handlePendingCandidatePurchase({database:db,message:message("27000"),pendingInteractions:pending,editMessage:io.editMessage,cleanupMessage:io.cleanupMessage});
 assert.equal(price.status,"awaiting_confirmation");
 assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_items").get().n,0);
 await handleCandidateCallback({database:db,callbackQuery:cb(`cand:confirm:${candidate.id}:0`),pendingInteractions:pending,editMessage:io.editMessage,answerCallback:io.answerCallback});
 assert.equal(db.prepare("SELECT purchase_price_krw p FROM inventory_items").get().p,27000);
 assert.equal(findCandidateById(db,candidate.id).status,"ACQUIRED");
 await handleCandidateCallback({database:db,callbackQuery:cb(`cand:confirm:${candidate.id}:0`),pendingInteractions:pending,editMessage:io.editMessage,answerCallback:io.answerCallback});
 assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_items").get().n,1);
}));

test("candidate exclusion removes from active listing",()=>dbRun(async db=>{
 const [candidate]=seed(db), io=transport(), pending=createPendingInteractionStore();
 await handleCandidateCallback({database:db,callbackQuery:cb(`cand:exclude:${candidate.id}:0`),pendingInteractions:pending,editMessage:io.editMessage,answerCallback:io.answerCallback});
 assert.equal(findCandidateById(db,candidate.id).status,"DISMISSED");
 assert.match(renderCandidatePage(db).text,/없습니다/);
}));

test("confirmation without price step cannot create inventory",()=>dbRun(async db=>{
 const [candidate]=seed(db), io=transport(), pending=createPendingInteractionStore();
 const result=await handleCandidateCallback({database:db,callbackQuery:cb(`cand:confirm:${candidate.id}:0`),pendingInteractions:pending,editMessage:io.editMessage,answerCallback:io.answerCallback});
 assert.equal(result.status,"invalid_confirmation");
 assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_items").get().n,0);
}));
