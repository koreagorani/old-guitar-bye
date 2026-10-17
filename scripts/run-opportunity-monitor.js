import { resolve } from "node:path";

import {
  formatOpportunityMonitorLog,
  loadOpportunityMonitorConfig,
  OpportunityMonitorError,
  runBunjangOpportunityMonitor,
} from "../src/application/listings/opportunity-monitor.js";
import {
  loadOpportunityTelegramConfig,
  notifyTrackOpportunities,
} from "../src/application/listings/opportunity-notifier.js";
import { createBunjangClient } from "../src/integrations/bunjang/bunjang-client.js";
import { createAcousticMartSource } from "../src/integrations/new-price/acousticmart-source.js";
import { createBuzzbeeSource } from "../src/integrations/new-price/buzzbee-source.js";
import { createGopherwoodSource } from "../src/integrations/new-price/gopherwood-source.js";
import { createMovlandSource } from "../src/integrations/new-price/movland-source.js";
import { createReferenceNewPriceResolver } from "../src/integrations/new-price/reference-price-resolver.js";
import { sendTelegramMessage } from "../src/telegram/telegram-client.js";
import { applyMigrations, openDatabase } from "./migrate.js";

const databasePath = resolve(
  process.env.DATABASE_PATH ?? process.argv[2] ?? "old-guitar-bye.sqlite",
);
const config = loadOpportunityMonitorConfig();
const telegram = loadOpportunityTelegramConfig();
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
    notifier: {
      notify: (opportunities) => notifyTrackOpportunities({
        database,
        opportunities,
        chatId: telegram.chatId,
        sendMessage: ({ chatId, text }) => sendTelegramMessage({
          token: telegram.token,
          chatId,
          text,
        }),
      }),
    },
    config,
  });

  for (const line of formatOpportunityMonitorLog(result)) {
    console.log(line);
  }

  if (result.notifier.failed > 0) {
    for (const failure of result.notifier.failures) {
      console.error(
        `[notifier] failure stage=${failure.stage} marketplace=${failure.marketplace} externalListingId=${failure.externalListingId} name=${failure.name} message=${failure.message}`,
      );
    }
    process.exitCode = 1;
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
