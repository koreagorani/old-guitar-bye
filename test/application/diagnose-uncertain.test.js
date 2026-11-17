import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseUncertain } from "../../src/application/listings/diagnose-uncertain.js";
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

test("detail probe has a three-request cap, delay, and no raw description", async () => {
  const listings = [1, 2, 3, 4].map((number) => listing(String(number), "무명 기타"));
  const sample = diagnoseUncertain({ listings, now }).sample;
  const calls = [];
  let requests = 0;
  const report = await probeUncertainDetails({
    sample,
    listings,
    merge: mergeBunjangDetail,
    wait: async (ms) => calls.push(ms),
    clock: () => 100,
    client: {
      async detail(id) {
        if (++requests === 2) throw Object.assign(new Error("private detail"), { status: 403 });
        return { data: { data: { product: { pid: id, name: "무명 기타", description: "브랜드: 야마하, 모델명: F310" } } } };
      },
    },
  });
  assert.equal(report.requests, 3);
  assert.deepEqual(calls, [1500, 1500]);
  assert.equal(report.failed, 1);
  assert.equal(report.detailsWithDescription, 2);
  assert.equal(report.results.find(({ status }) => status === "REQUEST_FAILED").httpStatus, 403);
  assert.equal(report.results.some((row) => JSON.stringify(row).includes("private detail")), false);
  assert.equal(report.results.some((row) => JSON.stringify(row).includes("브랜드:")), false);
});
