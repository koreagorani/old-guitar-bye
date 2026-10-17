import { resolve } from "node:path";

import {
  formatOpportunityMonitorLog,
  loadOpportunityMonitorConfig,
  OpportunityMonitorError,
  runBunjangOpportunityMonitor,
} from "../src/application/listings/opportunity-monitor.js";
import { createBunjangClient } from "../src/integrations/bunjang/bunjang-client.js";
import { createAcousticMartSource } from "../src/integrations/new-price/acousticmart-source.js";
import { createBuzzbeeSource } from "../src/integrations/new-price/buzzbee-source.js";
import { createGopherwoodSource } from "../src/integrations/new-price/gopherwood-source.js";
import { createMovlandSource } from "../src/integrations/new-price/movland-source.js";
import { createReferenceNewPriceResolver } from "../src/integrations/new-price/reference-price-resolver.js";
import { applyMigrations, openDatabase } from "./migrate.js";

const databasePath = resolve(
  process.env.DATABASE_PATH ?? process.argv[2] ?? "old-guitar-bye.sqlite",
);
const config = loadOpportunityMonitorConfig();
const database = openDatabase(databasePath);

try {
  applyMigrations(database);

  const resolver = createReferenceNewPriceResolver({
    sources: [
      createAcousticMartSource(),
      createMovlandSource(),
      createBuzzbeeSource(),
      createGopherwoodSource(),
    ],
  });

  const result = await runBunjangOpportunityMonitor({
    database,
    client: createBunjangClient(),
    resolver,
    config,
  });

  for (const line of formatOpportunityMonitorLog(result)) {
    console.log(line);
  }
} catch (error) {
  if (error instanceof OpportunityMonitorError) {
    console.error(
      `[monitor] failed stage=${error.stage} name=${error.cause?.name ?? "Error"} message=${error.cause?.message ?? error.message}`,
    );
  } else {
    console.error(
      `[monitor] failed stage=SETUP name=${error?.name ?? "Error"} message=${error?.message ?? String(error)}`,
    );
  }
  process.exitCode = 1;
} finally {
  database.close();
}
