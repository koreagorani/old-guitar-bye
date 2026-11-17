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
  assert.equal(report.total, 2);
  assert.equal(report.patterns.SUSPECTED_UNRELATED_SEARCH_RESULT.count, 1);
  assert.equal(output.stdout.includes("010-1234-5678"), false);
  assert.deepEqual(readFileSync(path), before);
  const compared = run("--compare-baseline");
  assert.equal(compared.status, 0, compared.stderr);
  assert.equal(JSON.parse(compared.stdout).comparison.changes.newlyIrrelevant, 1);
  assert.equal(JSON.parse(compared.stdout).comparison.changes.newlyReferenceEligible, 0);
  assert.deepEqual(readFileSync(path), before);
  assert.notEqual(run("--unknown").status, 0);
  assert.deepEqual(readFileSync(path), before);
});
