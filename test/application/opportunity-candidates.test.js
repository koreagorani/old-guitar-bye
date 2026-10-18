import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import {
  registerTrackCandidates, dismissCandidate, findCandidateById, listActiveCandidates,
} from "../../src/repositories/opportunity-candidate-repository.js";
import { acquireCandidate } from "../../src/application/listings/acquire-candidate.js";
import { findAcquisitionByListingId } from "../../src/repositories/acquisition-repository.js";

const at = "2026-10-18T10:00:00Z";
async function withDb(fn) {
  const dir=mkdtempSync(join(tmpdir(),"candidate-integration-"));
  const db=openDatabase(join(dir,"test.sqlite"));
  try { applyMigrations(db); return await fn(db); }
  finally {db.close();rmSync(dir,{force:true,recursive:true});}
}
function opportunity(id, override={}) {
  return {
    marketplace:"BUNJANG", externalListingId:id,
    title:`Yamaha F310 ${id}`,url:`https://m.bunjang.co.kr/products/${id}`,
    askingPriceKrw:20000, brand:"YAMAHA",model:"F310",variant:null,
    guitarType:"ACOUSTIC",identityConfidence:"HIGH",
    referenceNewPriceKrw:195000,ratioPct:20000/195000*100,
    decision:"TRACK",...override,
  };
}
function insertListing(db,item) {
  db.prepare(`INSERT INTO listings (marketplace,external_listing_id,url,title,description,asking_price_krw,discovered_at,last_seen_at)
  VALUES (?,?,?,?,?,?,?,?)`).run(
    item.marketplace,item.externalListingId,item.url,item.title,"",item.askingPriceKrw,at,at,
  );
}
const run=(db,ops)=>registerTrackCandidates(db,ops,{now:()=>new Date(at)});

test("TRACK is automatically persisted, non-TRACK never registered",()=>withDb(async db=>{
  const values=[
    opportunity("100"),
    opportunity("101",{decision:"IGNORE"}),
    opportunity("102",{decision:"UNRESOLVED_REFERENCE"}),
    opportunity("103",{decision:"UNRESOLVED_IDENTITY"}),
  ];
  values.forEach(v=>insertListing(db,v));
  assert.equal(run(db,values).created,1);
  assert.equal(listActiveCandidates(db).total,1);
  assert.equal(run(db,values).existing,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM opportunity_candidates").get().n,1);
}));

test("exclusion is permanent across repeated registration and restart",()=>withDb(async db=>{
  const op=opportunity("200");
  insertListing(db,op);
  const first=run(db,[op]).candidates[0];
  assert.equal(dismissCandidate(db,first.id).changed,true);
  assert.equal(dismissCandidate(db,first.id).changed,false);
  assert.equal(run(db,[op]).suppressed,1);
  assert.equal(listActiveCandidates(db).total,0);
  assert.equal(findCandidateById(db,first.id).status,"DISMISSED");
}));

test("received acquisition and inventory created once using actual paid price",()=>withDb(async db=>{
  const op=opportunity("300",{askingPriceKrw:15000});
  insertListing(db,op);
  const candidate=run(db,[op]).candidates[0];
  const result=acquireCandidate(db,{
    candidateId:candidate.id,purchasePriceKrw:26789,receivedAt:at,
  });
  assert.equal(result.status,"acquired");
  assert.equal(result.inventory.purchasePriceKrw,26789);
  assert.equal(result.inventory.state,"IN_STOCK");
  assert.equal(result.inventory.modelName,"F310");
  const acquisition=findAcquisitionByListingId(db,candidate.listingId);
  assert.equal(acquisition.status,"RECEIVED");
  assert.equal(acquisition.agreedPurchasePriceKrw,26789);
  assert.equal(findCandidateById(db,candidate.id).status,"ACQUIRED");
  assert.equal(run(db,[op]).suppressed,1);
  assert.equal(acquireCandidate(db,{candidateId:candidate.id,purchasePriceKrw:100,receivedAt:at}).status,"not_active");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_items").get().n,1);
}));

test("invalid purchase price rolls back all mutations",()=>withDb(async db=>{
  const op=opportunity("400");insertListing(db,op);
  const candidate=run(db,[op]).candidates[0];
  assert.throws(()=>acquireCandidate(db,{candidateId:candidate.id,purchasePriceKrw:-1,receivedAt:at}),/purchasePriceKrw/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM acquisitions").get().n,0);
  assert.equal(findCandidateById(db,candidate.id).status,"ACTIVE");
}));

test("active candidate list sorts by ratio and pages",()=>withDb(async db=>{
  const arr=Array.from({length:11},(_,i)=>opportunity(String(500+i),{
    ratioPct:11-i,askingPriceKrw:11000-i*1000,
  }));
  arr.forEach(x=>insertListing(db,x));
  run(db,arr);
  assert.equal(listActiveCandidates(db).total,11);
  const page0=listActiveCandidates(db,{page:0});
  const page1=listActiveCandidates(db,{page:1});
  const page2=listActiveCandidates(db,{page:2});
  assert.equal(page0.rows.length,5);
  assert.equal(page2.rows.length,1);
  assert.equal(page0.rows[0].externalListingId,"510");
  assert.equal(page1.rows[0].externalListingId,"505");
}));

test("registration refuses unknown TRACK listing and rolls back",()=>withDb(async db=>{
  assert.throws(()=>run(db,[opportunity("999")]),/missing from DB/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM opportunity_candidates").get().n,0);
}));
