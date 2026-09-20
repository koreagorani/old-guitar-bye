import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import {
  findInventoryItemByCode,
  listActiveInventoryItems,
  updateInventoryState,
} from "../../repositories/inventory-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import {
  EMPTY_INVENTORY_MESSAGE,
  renderInventoryList,
} from "../render/inventory-list-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";
import { beginCompleteSaleFlow } from "../interactions/complete-sale-flow.js";
import {
  beginExpenseFlow,
  beginExpenseMenu,
} from "../interactions/expense-flow.js";
import {
  beginRepairLogFlow,
  beginRepairMenu,
} from "../interactions/repair-log-flow.js";
import { parseInventoryCallbackData } from "./inventory-callback-parser.js";

export const CALLBACK_MESSAGES = Object.freeze({
  start_repair: "수리 중으로 변경했습니다.",
  mark_for_sale: "판매 가능 상태로 변경했습니다.",
  finish_repair: "수리를 완료하고 판매 가능 상태로 변경했습니다.",
});

export const INVALID_CALLBACK_MESSAGE = "올바르지 않은 작업입니다.";
export const INVALID_STATE_MESSAGE = "현재 상태에서는 이 작업을 할 수 없습니다.";
export const INVENTORY_NOT_FOUND_CALLBACK_MESSAGE = "해당 재고를 찾을 수 없습니다.";

const NEXT_STATE_BY_ACTION = Object.freeze({
  start_repair: "REPAIRING",
  mark_for_sale: "FOR_SALE",
  finish_repair: "FOR_SALE",
});

const REQUIRED_STATE_BY_ACTION = Object.freeze({
  start_repair: "IN_STOCK",
  mark_for_sale: "IN_STOCK",
  finish_repair: "REPAIRING",
});

async function acknowledge(answerCallback, callbackQueryId, text) {
  await answerCallback({ callbackQueryId, text });
}

export async function handleInventoryCallback({
  database,
  callbackQuery,
  editMessage,
  answerCallback,
  sendMessage,
  pendingInteractions,
}) {
  let parsed;
  try {
    parsed = parseInventoryCallbackData(callbackQuery?.data);
  } catch {
    await acknowledge(
      answerCallback,
      callbackQuery?.id,
      INVALID_CALLBACK_MESSAGE,
    );
    return { status: "invalid" };
  }

  const { action, inventoryCode } = parsed;
  if (action === "list") {
    const inventoryItems = listActiveInventoryItems(database);
    const rendered = inventoryItems.length === 0
      ? {
        text: EMPTY_INVENTORY_MESSAGE,
        replyMarkup: { inline_keyboard: [] },
      }
      : renderInventoryList(inventoryItems);
    await editMessage({
      chatId: callbackQuery.message.chat.id,
      messageId: callbackQuery.message.message_id,
      ...rendered,
    });
    await acknowledge(answerCallback, callbackQuery.id, null);
    return { status: "listed", count: inventoryItems.length };
  }

  const inventory = findInventoryItemByCode(database, inventoryCode);
  if (!inventory) {
    await acknowledge(
      answerCallback,
      callbackQuery.id,
      INVENTORY_NOT_FOUND_CALLBACK_MESSAGE,
    );
    return { status: "not_found", inventoryCode };
  }

  if (action === "complete_sale") {
    return beginCompleteSaleFlow({
      inventory,
      callbackQuery,
      pendingInteractions,
      sendMessage,
      answerCallback,
    });
  }

  if (action === "repair") {
    return beginRepairMenu({
      inventory,
      callbackQuery,
      editMessage,
      answerCallback,
    });
  }

  if (action === "expense") {
    return beginExpenseMenu({
      inventory,
      callbackQuery,
      editMessage,
      answerCallback,
    });
  }

  if (action === "add_repair_log") {
    return beginRepairLogFlow({
      inventory,
      callbackQuery,
      pendingInteractions,
      sendMessage,
      answerCallback,
    });
  }

  if (action === "add_expense") {
    return beginExpenseFlow({
      inventory,
      callbackQuery,
      pendingInteractions,
      sendMessage,
      answerCallback,
    });
  }

  let currentInventory = inventory;
  const nextState = NEXT_STATE_BY_ACTION[action];
  if (nextState !== undefined) {
    if (inventory.state !== REQUIRED_STATE_BY_ACTION[action]) {
      await acknowledge(
        answerCallback,
        callbackQuery.id,
        INVALID_STATE_MESSAGE,
      );
      return { status: "invalid_state", action, inventoryCode };
    }
    try {
      currentInventory = updateInventoryState(
        database,
        inventory.id,
        nextState,
      );
    } catch (error) {
      if (!error.message.startsWith("Invalid inventory transition:")) {
        throw error;
      }
      await acknowledge(
        answerCallback,
        callbackQuery.id,
        INVALID_STATE_MESSAGE,
      );
      return { status: "invalid_state", action, inventoryCode };
    }
  }

  const detail = getInventoryDetail(database, currentInventory.id);
  const text = renderInventoryDetail(detail);
  const actions = renderInventoryActions(detail.inventory.state);
  const replyMarkup = buildInventoryInlineKeyboard(actions, inventoryCode);

  await editMessage({
    chatId: callbackQuery.message.chat.id,
    messageId: callbackQuery.message.message_id,
    text,
    replyMarkup,
  });
  await acknowledge(
    answerCallback,
    callbackQuery.id,
    CALLBACK_MESSAGES[action] ?? null,
  );

  return {
    status: action === "open" ? "opened" : "updated",
    action,
    inventoryItemId: currentInventory.id,
  };
}
