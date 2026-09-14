import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { handleInventoryCommand } from "./commands/inventory-command.js";
import {
  getTelegramUpdates,
  sendTelegramMessage,
} from "./telegram-client.js";

export const START_MESSAGE = "기타 재고 관리 봇입니다.";

function commandName(text) {
  if (typeof text !== "string") {
    return null;
  }
  return text.trim().split(/\s+/, 1)[0].split("@", 1)[0];
}

export async function handleTelegramUpdate(update, { database, sendMessage }) {
  const message = update?.message;
  if (!message || typeof message.text !== "string") {
    return { status: "ignored" };
  }

  const name = commandName(message.text);
  if (name === "/start") {
    await sendMessage({ chatId: message.chat.id, text: START_MESSAGE });
    return { status: "started" };
  }
  if (name === "/inventory") {
    return handleInventoryCommand({
      database,
      chatId: message.chat.id,
      commandText: message.text,
      sendMessage,
    });
  }

  return { status: "ignored" };
}

export async function runBot({
  token = process.env.TELEGRAM_BOT_TOKEN,
  databasePath = process.env.DATABASE_PATH,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  if (typeof databasePath !== "string" || databasePath.trim() === "") {
    throw new Error("DATABASE_PATH is required");
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  let offset = 0;
  const sendMessage = (message) => sendTelegramMessage({
    token,
    fetchImpl,
    ...message,
  });

  try {
    while (!signal?.aborted) {
      const updates = await getTelegramUpdates({
        token,
        offset,
        fetchImpl,
      });
      for (const update of updates) {
        await handleTelegramUpdate(update, { database, sendMessage });
        offset = Math.max(offset, update.update_id + 1);
      }
    }
  } finally {
    database.close();
  }
}

const isRunDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isRunDirectly) {
  runBot().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
