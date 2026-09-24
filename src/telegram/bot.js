import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { handleInventoryCommand } from "./commands/inventory-command.js";
import { handleInventoryCallback } from "./callbacks/inventory-callback-handler.js";
import {
  handlePendingSaleMessage,
  handleSaleMarketplaceCallback,
} from "./interactions/complete-sale-flow.js";
import {
  handleExpenseMenuCallback,
  handlePendingExpenseMessage,
} from "./interactions/expense-flow.js";
import {
  handlePendingRepairMessage,
  handleRepairMenuCallback,
} from "./interactions/repair-log-flow.js";
import {
  beginAddInventoryFlow,
  handleAddInventoryCallback,
  handlePendingAddInventoryMessage,
} from "./interactions/add-inventory-flow.js";
import { createPendingInteractionStore } from "./interactions/pending-interaction-store.js";
import {
  isAllowedTelegramChat,
  normalizeTelegramChatId,
} from "./telegram-access.js";
import {
  answerTelegramCallbackQuery,
  deleteTelegramMessage,
  editTelegramMessageText,
  getTelegramUpdates,
  sendTelegramMessage,
  setTelegramChatMenuButton,
  setTelegramCommands,
} from "./telegram-client.js";

export const START_MESSAGE = "기타 재고 관리 봇입니다.";
export const HELP_MESSAGE = [
  "🎸 기타 관리 봇",
  "",
  "사용 가능한 명령:",
  "",
  "/inventory",
  "현재 보유 기타 보기",
  "",
  "/add",
  "새 기타 등록",
  "",
  "/help",
  "사용 방법 보기",
].join("\n");

export const TELEGRAM_COMMANDS = Object.freeze([
  Object.freeze({ command: "start", description: "봇 안내" }),
  Object.freeze({ command: "inventory", description: "현재 재고 목록 조회" }),
  Object.freeze({ command: "add", description: "새 기타 등록" }),
  Object.freeze({ command: "help", description: "사용 가능한 기능 안내" }),
]);

function commandName(text) {
  if (typeof text !== "string") {
    return null;
  }
  return text.trim().split(/\s+/, 1)[0].split("@", 1)[0];
}

async function handleAuthorizedCallback(callbackQuery, answerCallback, handler) {
  let acknowledgementAttempted = false;
  let handlerError = null;
  const acknowledge = async (payload) => {
    acknowledgementAttempted = true;
    return answerCallback(payload);
  };

  try {
    return await handler(acknowledge);
  } catch (error) {
    handlerError = error;
    throw error;
  } finally {
    if (!acknowledgementAttempted) {
      try {
        await answerCallback({ callbackQueryId: callbackQuery.id });
      } catch (acknowledgementError) {
        if (handlerError === null) {
          throw acknowledgementError;
        }
      }
    }
  }
}

export async function handleTelegramUpdate(
  update,
  {
    database,
    sendMessage,
    editMessage,
    answerCallback,
    deleteMessage = async () => {},
    allowedChatId,
    pendingInteractions = createPendingInteractionStore(),
    now,
    logger = console,
  },
) {
  const callbackQuery = update?.callback_query;
  if (callbackQuery) {
    if (!isAllowedTelegramChat(
      callbackQuery.message?.chat?.id,
      allowedChatId,
    )) {
      return { status: "ignored" };
    }
    return handleAuthorizedCallback(
      callbackQuery,
      answerCallback,
      (acknowledge) => {
        if (callbackQuery.data?.startsWith("add:")) {
          return handleAddInventoryCallback({
            callbackQuery,
            pendingInteractions,
            editMessage,
            answerCallback: acknowledge,
          });
        }
        if (callbackQuery.data?.startsWith("sale:listing:")) {
          return handleSaleMarketplaceCallback({
            database,
            callbackQuery,
            pendingInteractions,
            sendMessage,
            editMessage,
            answerCallback: acknowledge,
            now,
          });
        }
        if (callbackQuery.data?.startsWith("repair:")) {
          return handleRepairMenuCallback({
            database,
            callbackQuery,
            pendingInteractions,
            editMessage,
            answerCallback: acknowledge,
            now,
          });
        }
        if (callbackQuery.data?.startsWith("expense:")) {
          return handleExpenseMenuCallback({
            database,
            callbackQuery,
            pendingInteractions,
            editMessage,
            answerCallback: acknowledge,
            now,
          });
        }
        return handleInventoryCallback({
          database,
          callbackQuery,
          editMessage,
          answerCallback: acknowledge,
          sendMessage,
          pendingInteractions,
        });
      },
    );
  }

  const message = update?.message;
  if (!message || typeof message.text !== "string") {
    return { status: "ignored" };
  }
  if (!isAllowedTelegramChat(message.chat?.id, allowedChatId)) {
    return { status: "ignored" };
  }

  const cleanupMessage = async ({ chatId, messageId }) => {
    if (!Number.isSafeInteger(messageId)) {
      return;
    }
    try {
      await deleteMessage({ chatId, messageId });
    } catch (error) {
      logger.warn("Failed to clean up Telegram message", {
        chatId,
        messageId,
        error,
      });
    }
  };

  const addResult = await handlePendingAddInventoryMessage({
    database,
    message,
    pendingInteractions,
    editMessage,
    cleanupMessage,
    now,
  });
  if (addResult !== null) {
    return addResult;
  }

  const repairResult = await handlePendingRepairMessage({
    database,
    message,
    pendingInteractions,
    sendMessage,
    editMessage,
    cleanupMessage,
    now,
  });
  if (repairResult !== null) {
    return repairResult;
  }

  const expenseResult = await handlePendingExpenseMessage({
    database,
    message,
    pendingInteractions,
    sendMessage,
    editMessage,
    cleanupMessage,
    now,
  });
  if (expenseResult !== null) {
    return expenseResult;
  }

  const pendingResult = await handlePendingSaleMessage({
    database,
    message,
    pendingInteractions,
    sendMessage,
    editMessage,
    cleanupMessage,
    now,
  });
  if (pendingResult !== null) {
    return pendingResult;
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
  if (name === "/add") {
    return beginAddInventoryFlow({
      chatId: message.chat.id,
      commandMessageId: message.message_id,
      pendingInteractions,
      sendMessage,
      cleanupMessage,
    });
  }
  if (name === "/help") {
    await sendMessage({ chatId: message.chat.id, text: HELP_MESSAGE });
    return { status: "helped" };
  }

  return { status: "ignored" };
}

export async function processTelegramUpdates(
  updates,
  {
    offset,
    logger = console,
    ...dependencies
  },
) {
  let nextOffset = offset;
  for (const update of updates) {
    try {
      await handleTelegramUpdate(update, { ...dependencies, logger });
    } catch (error) {
      logger.error("Failed to handle Telegram update", {
        updateId: update.update_id,
        error,
      });
    } finally {
      nextOffset = Math.max(nextOffset, update.update_id + 1);
    }
  }
  return nextOffset;
}

export async function runBot({
  token = process.env.TELEGRAM_BOT_TOKEN,
  databasePath = process.env.DATABASE_PATH,
  allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID,
  fetchImpl = globalThis.fetch,
  signal,
  logger = console,
} = {}) {
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  if (typeof databasePath !== "string" || databasePath.trim() === "") {
    throw new Error("DATABASE_PATH is required");
  }
  if (allowedChatId === undefined || allowedChatId === null
    || (typeof allowedChatId === "string" && allowedChatId.trim() === "")) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID is required");
  }
  const normalizedAllowedChatId = normalizeTelegramChatId(
    allowedChatId,
    "TELEGRAM_ALLOWED_CHAT_ID",
  );

  const database = new DatabaseSync(databasePath);
  const pendingInteractions = createPendingInteractionStore();
  let offset = 0;
  const sendMessage = (message) => sendTelegramMessage({
    token,
    fetchImpl,
    ...message,
  });
  const editMessage = (message) => editTelegramMessageText({
    token,
    fetchImpl,
    ...message,
  });
  const answerCallback = (callback) => answerTelegramCallbackQuery({
    token,
    fetchImpl,
    ...callback,
  });
  const deleteMessage = (message) => deleteTelegramMessage({
    token,
    fetchImpl,
    ...message,
  });

  try {
    await setTelegramCommands({
      token,
      commands: TELEGRAM_COMMANDS,
      fetchImpl,
    });
    await setTelegramChatMenuButton({ token, fetchImpl });
    while (!signal?.aborted) {
      const updates = await getTelegramUpdates({
        token,
        offset,
        fetchImpl,
      });
      offset = await processTelegramUpdates(updates, {
        offset,
        database,
        sendMessage,
        editMessage,
        answerCallback,
        deleteMessage,
        allowedChatId: normalizedAllowedChatId,
        pendingInteractions,
        logger,
      });
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
