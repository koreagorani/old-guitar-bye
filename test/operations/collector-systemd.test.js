import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(
  new URL("../../deploy/systemd/old-guitar-bye-collector.service", import.meta.url),
  "utf8",
);
const timer = readFileSync(
  new URL("../../deploy/systemd/old-guitar-bye-collector.timer", import.meta.url),
  "utf8",
);

test("collector service points at the production project and database", () => {
  assert.match(service, /User=ubuntu/);
  assert.match(service, /WorkingDirectory=\/home\/ubuntu\/old-guitar-bye/);
  assert.match(service, /DATABASE_PATH=\/home\/ubuntu\/old-guitar-bye\/data\/guitar\.db/);
  assert.match(service, /BUNJANG_ENRICH_DETAILS=false/);
  assert.match(service, /OPPORTUNITY_THRESHOLD_PCT=12/);
  assert.match(service, /ExecStart=\/usr\/bin\/node scripts\/run-opportunity-monitor\.js/);
});

test("collector timer starts after boot and repeats every 30 minutes", () => {
  assert.match(timer, /OnBootSec=5min/);
  assert.match(timer, /OnUnitActiveSec=30min/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /Unit=old-guitar-bye-collector\.service/);
});
