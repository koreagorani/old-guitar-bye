import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";

test("UNCERTAIN CLI reads only Bunjang without changing DB or requesting details", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "guitar-uncertain-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "guitar.sqlite");
  const db = openDatabase(path);
  try {
    applyMigrations(db);
    for (const marketplace of ["BUNJANG", "DAANGN"]) {
      saveOrUpdateListing(db, {
        marketplace,
        externalListingId: "123",
        url: "https://m.bunjang.co.kr/products/123",
        title: "Crafter TIDY 010-1234-5678",
        description: "",
        askingPriceKrw: 10000,
        sellerLocationText: null,
        discoveredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });
    }
  } finally {
    db.close();
  }
  const before = readFileSync(path);
  const script = fileURLToPath(new URL("../../scripts/diagnose-uncertain.js", import.meta.url));
  const run = (dbPath) => spawnSync(process.execPath, [script], {
    encoding: "utf8", env: { ...process.env, DATABASE_PATH: dbPath },
  });
  const output = run(path);
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.deepEqual(report.counts, { RELEVANT: 0, IRRELEVANT: 0, UNCERTAIN: 1 });
  assert.equal(report.sample[0].title.includes("010-1234-5678"), false);
  assert.equal(report.sample[0].originalDetail, "MISSING_DATA");
  assert.equal(report.detailProbe, undefined);
  assert.deepEqual(readFileSync(path), before);

  const missing = join(directory, "missing.sqlite");
  assert.notEqual(run(missing).status, 0);
  assert.equal(existsSync(missing), false);
});
