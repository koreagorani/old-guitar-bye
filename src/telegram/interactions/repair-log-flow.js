import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { addRepairLog } from "../../repositories/repair-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const REPAIR_TYPE_PROMPT = "수리 내용을 입력해주세요.\n예: 줄 교체\n취소: /cancel";
export const REPAIR_COST_PROMPT = "비용을 입력해주세요.\n무료 작업이면 0을 입력해주세요.\n예: 8000\n취소: /cancel";
export const INVALID_REPAIR_TYPE_MESSAGE = "수리 내용은 비워둘 수 없습니다.";
export const INVALID_REPAIR_COST_MESSAGE = "비용은 0 이상의 숫자로 입력해주세요.";
export const REPAIR_CANCELLED_MESSAGE = "수리 기록 추가를 취소했습니다.";

export const REPAIR_INPUT_STEPS = Object.freeze({
  TYPE: "AWAITING_REPAIR_TYPE",
  COST: "AWAITING_REPAIR_COST",
});

const krwFormatter = new Intl.NumberFormat("ko-KR");

function parseRepairCost(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    return null;
  }
  const cost = Number(text.trim());
  return Number.isSafeInteger(cost) ? cost : null;
}

function renderUpdatedInventory(database, inventoryItemId, inventoryCode) {
  const detail = getInventoryDetail(database, inventoryItemId);
  return {
    text: renderInventoryDetail(detail),
    replyMarkup: buildInventoryInlineKeyboard(
      renderInventoryActions(detail.inventory.state),
      inventoryCode,
    ),
  };
}

export async function beginRepairLogFlow({
  inventory,
  callbackQuery,
  pendingInteractions,
  sendMessage,
  answerCallback,
}) {
  const chatId = callbackQuery.message.chat.id;
  pendingInteractions.set(chatId, {
    type: "repair_log",
    step: REPAIR_INPUT_STEPS.TYPE,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    detailMessageId: callbackQuery.message.message_id,
  });
  await sendMessage({ chatId, text: REPAIR_TYPE_PROMPT });
  await answerCallback({ callbackQueryId: callbackQuery.id });

  return {
    status: "awaiting_repair_type",
    inventoryItemId: inventory.id,
  };
}

export async function handlePendingRepairMessage({
  database,
  message,
  pendingInteractions,
  sendMessage,
  editMessage,
  now = () => new Date(),
}) {
  const interaction = pendingInteractions.get(message.chat.id);
  if (!interaction || interaction.type !== "repair_log") {
    return null;
  }

  if (message.text.trim() === "/cancel") {
    pendingInteractions.delete(message.chat.id);
    await sendMessage({
      chatId: message.chat.id,
      text: REPAIR_CANCELLED_MESSAGE,
    });
    return { status: "cancelled" };
  }

  if (interaction.step === REPAIR_INPUT_STEPS.TYPE) {
    const repairType = message.text.trim();
    if (repairType === "") {
      await sendMessage({
        chatId: message.chat.id,
        text: INVALID_REPAIR_TYPE_MESSAGE,
      });
      return { status: "invalid_repair_type" };
    }

    pendingInteractions.set(message.chat.id, {
      ...interaction,
      step: REPAIR_INPUT_STEPS.COST,
      repairType,
    });
    await sendMessage({ chatId: message.chat.id, text: REPAIR_COST_PROMPT });
    return { status: "awaiting_repair_cost" };
  }

  const costKrw = parseRepairCost(message.text);
  if (costKrw === null) {
    await sendMessage({
      chatId: message.chat.id,
      text: INVALID_REPAIR_COST_MESSAGE,
    });
    return { status: "invalid_repair_cost" };
  }

  const repairLog = addRepairLog(database, {
    inventoryItemId: interaction.inventoryItemId,
    type: interaction.repairType,
    costKrw,
    minutesSpent: null,
    note: null,
    performedAt: now().toISOString(),
  });

  pendingInteractions.delete(message.chat.id);
  const updated = renderUpdatedInventory(
    database,
    interaction.inventoryItemId,
    interaction.inventoryCode,
  );
  await editMessage({
    chatId: message.chat.id,
    messageId: interaction.detailMessageId,
    ...updated,
  });
  await sendMessage({
    chatId: message.chat.id,
    text: [
      "수리 기록을 추가했습니다.",
      `${interaction.repairType} / ${krwFormatter.format(costKrw)}원`,
    ].join("\n"),
  });

  return {
    status: "repair_log_added",
    repairLogId: repairLog.id,
    inventoryItemId: interaction.inventoryItemId,
  };
}
