import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";

test("title-pattern CLI reads only Bunjang and never modifies the database", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "guitar-title-patterns-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "guitar.sqlite");
  const db = openDatabase(path);
  try {
    applyMigrations(db);
    for (const marketplace of ["BUNJANG", "DAANGN"]) {
      saveOrUpdateListing(db, {
        marketplace, externalListingId: "123", url: "https://m.bunjang.co.kr/products/123",
        title: "나이키 운동화 010-1234-5678", description: "", askingPriceKrw: 10000,
        sellerLocationText: null, discoveredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });
    }
    saveOrUpdateListing(db, {
      marketplace: "BUNJANG", externalListingId: "124",
      url: "https://m.bunjang.co.kr/products/124", title: "기타 거치대",
      description: "", askingPriceKrw: 10000, sellerLocationText: null,
      discoveredAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
    });
    saveOrUpdateListing(db, {
      marketplace: "BUNJANG", externalListingId: "125",
      url: "https://m.bunjang.co.kr/products/125",
      title: "cort 콜트 베이스기타 사용 10회미만, 기타 입문용 앰프 15w 8인치 스피커 기타 거치대 세트 판매",
      description: "", askingPriceKrw: 10000, sellerLocationText: null,
      discoveredAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
    });
  } finally {
    db.close();
  }
  const before = readFileSync(path);
  const script = fileURLToPath(new URL("../../scripts/diagnose-title-patterns.js", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", env: { ...process.env, DATABASE_PATH: path },
  });
  const output = run();
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.equal(report.total, 3);
  assert.equal(report.patterns.SUSPECTED_UNRELATED_SEARCH_RESULT.count, 1);
  assert.equal(output.stdout.includes("010-1234-5678"), false);
  assert.deepEqual(readFileSync(path), before);
  const compared = run("--compare-baseline");
  assert.equal(compared.status, 0, compared.stderr);
  assert.equal(JSON.parse(compared.stdout).comparison.changes.newlyIrrelevant, 1);
  assert.equal(JSON.parse(compared.stdout).comparison.changes.newlyReferenceEligible, 0);
  assert.deepEqual(readFileSync(path), before);
  const identityCompared = run("--compare-identity-baseline");
  assert.equal(identityCompared.status, 0, identityCompared.stderr);
  const identityReport = JSON.parse(identityCompared.stdout);
  assert.equal(identityReport.comparison.identityChanges.safetyDowngrades.length, 1);
  assert.equal(identityReport.comparison.identityChanges.safetyDowngrades[0].before.model, "15W");
  assert.equal(identityReport.comparison.identityChanges.safetyDowngrades[0].after.model, null);
  assert.equal(identityReport.comparison.changes.lostReferenceEligible, 1);
  assert.deepEqual(readFileSync(path), before);
  assert.notEqual(run("--unknown").status, 0);
  assert.deepEqual(readFileSync(path), before);
});
