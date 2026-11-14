import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyMigrations, openDatabase } from "../../scripts/migrate.js";
import { saveOrUpdateListing } from "../../src/repositories/listing-repository.js";

test("identity CLI reads Bunjang only and leaves the database unchanged", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "guitar-diagnosis-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "fixture.sqlite");
  const database = openDatabase(dbPath);
  try {
    applyMigrations(database);
    for (const marketplace of ["BUNJANG", "DAANGN"]) {
      saveOrUpdateListing(database, {
        marketplace,
        externalListingId: "42",
        title: "야마하 통기타",
        description: "",
        askingPriceKrw: 50000,
        sellerLocationText: null,
        url: "https://example.test/42",
        discoveredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });
    }
  } finally {
    database.close();
  }

  const before = readFileSync(dbPath);
  const script = fileURLToPath(new URL("../../scripts/diagnose-low-confidence.js", import.meta.url));
  const run = (path) => spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_PATH: path },
  });

  const output = run(dbPath);
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.equal(report.allTime.totalListings, 1);
  assert.equal(report.lowConfidenceCount, 1);
  assert.equal(report.samples[0].url, "https://example.test/42");
  assert.deepEqual(readFileSync(dbPath), before);

  const missing = join(directory, "missing.sqlite");
  const failure = run(missing);
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /Database does not exist/);
  assert.equal(existsSync(missing), false);
});
