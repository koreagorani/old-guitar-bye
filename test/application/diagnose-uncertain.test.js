import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseUncertain, redactListingText } from "../../src/application/listings/diagnose-uncertain.js";
import { probeUncertainDetails } from "../../src/application/listings/probe-uncertain-details.js";
import { mergeBunjangDetail } from "../../src/integrations/bunjang/bunjang-parser.js";

const now = () => new Date("2026-11-17T00:00:00Z");
const listing = (id, title, description = "") => ({
  externalListingId: id,
  title,
  description,
  url: `https://m.bunjang.co.kr/products/${id}`,
  lastSeenAt: "2026-11-16T00:00:00Z",
});

test("counts all UNCERTAIN reasons and separates missing stored text from seller omission", () => {
  const listings = [
    listing("1", "Crafter TIDY"),
    listing("2", "고퍼우드 WHITE501"),
    listing("3", "무슨 기타인지 몰라요", "브랜드: 야마하, 모델명: F310. 통기타 본체 판매"),
    listing("4", "펜더 베이스기타 소프트백"),
    listing("5", "YAMAHA F310 통기타"),
    listing("6", "기타 스트랩"),
    { ...listing("7", "stale"), lastSeenAt: "2026-09-01T00:00:00Z" },
  ];
  const report = diagnoseUncertain({ listings, now, sampleSize: 3 });
  assert.deepEqual(report.counts, { RELEVANT: 1, IRRELEVANT: 2, UNCERTAIN: 3 });
  assert.equal(report.uncertainReasons.NO_DECISIVE_GUITAR_BODY_SIGNAL.count, 2);
  assert.equal(report.uncertainReasons.DESCRIPTION_BODY_CONTEXT.count, 1);
  assert.equal(report.uncertainReasons.NO_DECISIVE_GUITAR_BODY_SIGNAL.pctOfUncertain, 66.67);
  assert.equal(report.dataCoverage.uncertain.storedDescriptionPresent.count, 1);
  assert.equal(report.dataCoverage.uncertain.storedDescriptionAddsModel.count, 1);
  assert.equal(report.dataCoverage.uncertain.titleModelDetected.count, 2);
  assert.equal(report.dataCoverage.uncertain.storedDescriptionLength.median, 0);
  assert.equal(report.sample.length, 3);
  assert.ok(report.sample.every(({ manualReview }) => manualReview === "NOT_REVIEWED"));
  assert.equal(report.sample.find(({ externalListingId }) => externalListingId === "1").modelEvidence, "TITLE");
  assert.equal(report.sample.find(({ externalListingId }) => externalListingId === "1").originalDetail, "MISSING_DATA");
  assert.deepEqual(diagnoseUncertain({ listings: [...listings].reverse(), now, sampleSize: 3 }).sample, report.sample);
});

test("detail probe records masked body, before and after decisions, failures, and latency", async () => {
  const listings = [1, 2, 3, 4].map((number) => listing(String(number), "무명 기타"));
  const sample = diagnoseUncertain({ listings, now }).sample;
  const calls = [];
  let requests = 0;
  const report = await probeUncertainDetails({
    sample,
    listings,
    merge: mergeBunjangDetail,
    wait: async (ms) => calls.push(ms),
    clock: (() => { let time = 0; return () => (time += 50); })(),
    client: {
      async detail(id) {
        if (++requests === 2) throw Object.assign(new Error("private detail"), { status: 403 });
        return { data: { data: { product: { pid: id, name: "무명 기타", description: "브랜드: 야마하, 모델명: F310. 일렉 기타 본체 판매. 연락 010-1234-5678, a@b.com" } } } };
      },
    },
  });
  assert.equal(report.failed, 1);
  assert.equal(report.detailsWithDescription, 1);
  assert.equal(report.succeeded, 1);
  assert.equal(report.descriptionPresentPctOfSucceeded, 100);
  assert.equal(report.addedBrand, 1);
  assert.equal(report.addedModel, 1);
  assert.equal(report.becameRelevant, 0);
  assert.equal(report.meanRequestMs, 50);
  assert.deepEqual(report.errorCounts, { HTTP_403: 1 });
  assert.equal(report.stopReason, "HTTP_403");
  assert.equal(report.requests, 2);
  assert.deepEqual(calls, [1500]);
  assert.equal(report.results.find(({ status }) => status === "REQUEST_FAILED").httpStatus, 403);
  const loaded = report.results.find(({ status }) => status === "DETAIL_LOADED");
  assert.equal(loaded.before.relevance, "UNCERTAIN");
  assert.equal(loaded.after.relevance, "UNCERTAIN");
  assert.equal(loaded.before.identity.brand, null);
  assert.equal(loaded.after.identity.brand, "YAMAHA");
  assert.equal(loaded.addedFromDescription.model, "F310");
  assert.equal(loaded.addedFromDescription.guitarType, "ELECTRIC");
  assert.deepEqual(loaded.addedFromDescription.relevanceReasons, ["ELECTRIC_KEYWORD", "DESCRIPTION_BODY_CONTEXT"]);
  assert.equal(loaded.manualReview, "NOT_REVIEWED");
  assert.match(loaded.description, /REDACTED_PHONE/);
  assert.match(loaded.description, /REDACTED_EMAIL/);
  assert.equal(loaded.descriptionLength, "브랜드: 야마하, 모델명: F310. 일렉 기타 본체 판매. 연락 010-1234-5678, a@b.com".length);
  assert.equal(report.results.some((row) => JSON.stringify(row).includes("private detail")), false);
  assert.equal(report.results.some((row) => JSON.stringify(row).includes("010-1234-5678")), false);
});

test("access challenge stops immediately even when HTTP status is 200", async () => {
  const listings = [1, 2].map((number) => listing(String(number), "무명 기타"));
  let requests = 0;
  const report = await probeUncertainDetails({
    sample: diagnoseUncertain({ listings, now }).sample,
    listings, merge: mergeBunjangDetail,
    client: { async detail() {
      requests += 1;
      throw Object.assign(new Error("Bunjang returned an access challenge"), {
        name: "BunjangAccessError", status: 200,
      });
    } },
  });
  assert.equal(requests, 1);
  assert.equal(report.stopReason, "ACCESS_CHALLENGE");
  assert.deepEqual(report.errorCounts, { ACCESS_CHALLENGE: 1 });
});

test("repeated HTTP 400 stops after two requests and duplicate IDs are not fetched", async () => {
  const listings = [1, 2, 3, 4].map((number) => listing(String(number), "무명 기타"));
  const sample = diagnoseUncertain({ listings, now }).sample;
  const waits = [];
  let requests = 0;
  const report = await probeUncertainDetails({
    sample: [sample[0], sample[0], ...sample.slice(1)],
    listings,
    merge: mergeBunjangDetail,
    limit: 4,
    wait: async (ms) => waits.push(ms),
    client: { async detail() {
      requests += 1;
      throw Object.assign(new Error("seller private details"), { status: 400 });
    } },
  });
  assert.equal(requests, 2);
  assert.deepEqual(waits, [1500]);
  assert.equal(report.selected, 4);
  assert.equal(report.failed, 2);
  assert.deepEqual(report.errorCounts, { HTTP_400: 2 });
  assert.equal(report.stopReason, "REPEATED_HTTP_400");
  assert.equal(JSON.stringify(report).includes("seller private details"), false);
});

test("the requested limit is capped at 30 and an empty detail is counted separately", async () => {
  const listings = Array.from({ length: 35 }, (_, index) => listing(String(index + 1), "무명 기타"));
  const sample = diagnoseUncertain({ listings, now }).sample;
  let calls = 0;
  const report = await probeUncertainDetails({
    sample, listings, merge: mergeBunjangDetail, limit: 30,
    wait: async () => {},
    client: { async detail(id) {
      calls += 1;
      return { data: { data: { product: { pid: id, description: "" } } } };
    } },
  });
  assert.equal(calls, 30);
  assert.equal(report.succeeded, 30);
  assert.equal(report.detailsWithDescription, 0);
  assert.equal(report.descriptionPresentPctOfSucceeded, 0);
  assert.equal(report.stopReason, null);
  await assert.rejects(
    probeUncertainDetails({ sample, listings, limit: 31, client: { detail() {} }, merge: () => {} }),
    /1 to 30/,
  );
});

test("default detail limit remains three", async () => {
  const listings = Array.from({ length: 5 }, (_, index) => listing(String(index + 1), "무명 기타"));
  const sample = diagnoseUncertain({ listings, now }).sample;
  const report = await probeUncertainDetails({
    sample, listings, merge: mergeBunjangDetail,
    wait: async () => {},
    client: { async detail(id) {
      return { data: { data: { product: { pid: id, description: "기타 정보 미상" } } } };
    } },
  });
  assert.equal(report.requestedLimit, 3);
  assert.equal(report.requests, 3);
  assert.equal(report.failed, 0);
});

test("masking covers phone, email, links, and long personal identifiers", () => {
  const masked = redactListingText("01012345678 02-1234-5678 a@b.com https://example.test/me 900101-1234567");
  assert.ok(!masked.includes("01012345678"));
  assert.ok(!masked.includes("02-1234-5678"));
  assert.ok(!masked.includes("a@b.com"));
  assert.ok(!masked.includes("https://example.test/me"));
  assert.ok(!masked.includes("900101-1234567"));
});
