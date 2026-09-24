import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { findInventoryItemByCode } from "../../repositories/inventory-repository.js";
import { addRepairLog } from "../../repositories/repair-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const REPAIR_TYPE_PROMPT = "수리 내용을 입력해주세요.\n예: 줄 교체\n취소: /cancel";
export const REPAIR_COST_PROMPT = "비용을 입력해주세요.\n무료 작업이면 0을 입력해주세요.\n예: 8000\n취소: /cancel";
export const INVALID_REPAIR_TYPE_MESSAGE = "수리 내용은 비워둘 수 없습니다.";
export const INVALID_REPAIR_COST_MESSAGE = "비용은 0 이상의 숫자로 입력해주세요.";
export const REPAIR_CANCELLED_MESSAGE = "수리 기록 추가를 취소했습니다.";
export const REPAIR_MENU_PROMPT = "수리 작업을 선택해주세요.";
export const REPAIR_COST_MENU_PROMPT = "비용을 선택해주세요.";
export const NO_PENDING_REPAIR_MESSAGE = "진행 중인 수리 입력이 없습니다.";

export const REPAIR_INPUT_STEPS = Object.freeze({
  TYPE: "AWAITING_REPAIR_TYPE",
  COST: "AWAITING_REPAIR_COST",
});

const REPAIR_TYPES = Object.freeze({
  string_change: "줄 교체",
  neck_adjustment: "넥 조정",
  cleaning: "세척",
  other: "기타 작업",
});

function repairTypeKeyboard(inventoryCode) {
  return {
    inline_keyboard: [
      [
        { text: "줄 교체", callback_data: `repair:type:string_change:${inventoryCode}` },
        { text: "넥 조정", callback_data: `repair:type:neck_adjustment:${inventoryCode}` },
      ],
      [
        { text: "세척", callback_data: `repair:type:cleaning:${inventoryCode}` },
        { text: "기타 작업", callback_data: `repair:type:other:${inventoryCode}` },
      ],
      [{ text: "뒤로", callback_data: `repair:back:detail:${inventoryCode}` }],
    ],
  };
}

function repairCostKeyboard(inventoryCode) {
  return {
    inline_keyboard: [
      [
        { text: "0원", callback_data: `repair:cost:zero:${inventoryCode}` },
        { text: "직접 입력", callback_data: `repair:cost:custom:${inventoryCode}` },
      ],
      [{ text: "뒤로", callback_data: `repair:back:types:${inventoryCode}` }],
    ],
  };
}

export function parseRepairCallbackData(callbackData) {
  if (typeof callbackData !== "string") {
    return null;
  }
  const match = /^repair:(type|cost|back):([a-z_]+):(G-\d{4})$/.exec(callbackData);
  if (!match) {
    return null;
  }
  const [, action, value, inventoryCode] = match;
  const valid = (action === "type" && Object.hasOwn(REPAIR_TYPES, value))
    || (action === "cost" && (value === "zero" || value === "custom"))
    || (action === "back" && (value === "types" || value === "detail"));
  return valid ? { action, value, inventoryCode } : null;
}

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

function saveRepairLog(database, interaction, costKrw, now) {
  return addRepairLog(database, {
    inventoryItemId: interaction.inventoryItemId,
    type: interaction.repairType,
    costKrw,
    minutesSpent: null,
    note: null,
    performedAt: now().toISOString(),
  });
}

export async function beginRepairMenu({
  inventory,
  callbackQuery,
  editMessage,
  answerCallback,
}) {
  await editMessage({
    chatId: callbackQuery.message.chat.id,
    messageId: callbackQuery.message.message_id,
    text: REPAIR_MENU_PROMPT,
    replyMarkup: repairTypeKeyboard(inventory.inventoryCode),
  });
  await answerCallback({ callbackQueryId: callbackQuery.id });
  return { status: "repair_menu", inventoryItemId: inventory.id };
}

export async function handleRepairMenuCallback({
  database,
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
  now = () => new Date(),
}) {
  const parsed = parseRepairCallbackData(callbackQuery?.data);
  if (!parsed) {
    await answerCallback({
      callbackQueryId: callbackQuery?.id,
      text: "올바르지 않은 수리 작업입니다.",
    });
    return { status: "invalid" };
  }

  const inventory = findInventoryItemByCode(database, parsed.inventoryCode);
  if (!inventory) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: "해당 재고를 찾을 수 없습니다.",
    });
    return { status: "not_found", inventoryCode: parsed.inventoryCode };
  }

  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  if (parsed.action === "back" && parsed.value === "detail") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId,
      ...renderUpdatedInventory(database, inventory.id, inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "repair_menu_closed" };
  }

  if (parsed.action === "back" && parsed.value === "types") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId,
      text: REPAIR_MENU_PROMPT,
      replyMarkup: repairTypeKeyboard(inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "repair_menu" };
  }

  if (parsed.action === "type") {
    const repairType = REPAIR_TYPES[parsed.value];
    pendingInteractions.set(chatId, {
      type: "repair_log",
      step: REPAIR_INPUT_STEPS.COST,
      repairType,
      inventoryItemId: inventory.id,
      inventoryCode: inventory.inventoryCode,
      mainMessageId: messageId,
    });
    await editMessage({
      chatId,
      messageId,
      text: `${repairType}\n${REPAIR_COST_MENU_PROMPT}`,
      replyMarkup: repairCostKeyboard(inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "awaiting_repair_cost_choice", repairType };
  }

  const interaction = pendingInteractions.get(chatId);
  if (!interaction || interaction.type !== "repair_log"
    || interaction.step !== REPAIR_INPUT_STEPS.COST
    || interaction.inventoryCode !== inventory.inventoryCode) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: NO_PENDING_REPAIR_MESSAGE,
    });
    return { status: "no_pending_repair" };
  }

  if (parsed.value === "custom") {
    await editMessage({
      chatId,
      messageId,
      text: REPAIR_COST_PROMPT,
      replyMarkup: { inline_keyboard: [[{
        text: "뒤로",
        callback_data: `repair:back:types:${inventory.inventoryCode}`,
      }]] },
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "awaiting_repair_cost" };
  }

  const repairLog = saveRepairLog(database, interaction, 0, now);
  pendingInteractions.delete(chatId);
  await editMessage({
    chatId,
    messageId,
    ...renderUpdatedInventory(database, inventory.id, inventory.inventoryCode),
  });
  await answerCallback({
    callbackQueryId: callbackQuery.id,
    text: `${interaction.repairType} / 0원 저장했습니다.`,
  });
  return {
    status: "repair_log_added",
    repairLogId: repairLog.id,
    inventoryItemId: inventory.id,
  };
}

export async function beginRepairLogFlow({
  inventory,
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
}) {
  const chatId = callbackQuery.message.chat.id;
  pendingInteractions.set(chatId, {
    type: "repair_log",
    step: REPAIR_INPUT_STEPS.TYPE,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    mainMessageId: callbackQuery.message.message_id,
  });
  await editMessage({
    chatId,
    messageId: callbackQuery.message.message_id,
    text: REPAIR_TYPE_PROMPT,
    replyMarkup: { inline_keyboard: [] },
  });
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
  editMessage,
  cleanupMessage,
  now = () => new Date(),
}) {
  const interaction = pendingInteractions.get(message.chat.id);
  if (!interaction || interaction.type !== "repair_log") {
    return null;
  }

  await cleanupMessage({
    chatId: message.chat.id,
    messageId: message.message_id,
  });

  if (message.text.trim() === "/cancel") {
    pendingInteractions.delete(message.chat.id);
    await editMessage({
      chatId: message.chat.id,
      messageId: interaction.mainMessageId,
      ...renderUpdatedInventory(
        database,
        interaction.inventoryItemId,
        interaction.inventoryCode,
      ),
    });
    return { status: "cancelled" };
  }

  if (interaction.step === REPAIR_INPUT_STEPS.TYPE) {
    const repairType = message.text.trim();
    if (repairType === "") {
      await editMessage({
        chatId: message.chat.id,
        messageId: interaction.mainMessageId,
        text: INVALID_REPAIR_TYPE_MESSAGE,
        replyMarkup: { inline_keyboard: [] },
      });
      return { status: "invalid_repair_type" };
    }

    pendingInteractions.set(message.chat.id, {
      ...interaction,
      step: REPAIR_INPUT_STEPS.COST,
      repairType,
    });
    await editMessage({
      chatId: message.chat.id,
      messageId: interaction.mainMessageId,
      text: REPAIR_COST_PROMPT,
      replyMarkup: { inline_keyboard: [] },
    });
    return { status: "awaiting_repair_cost" };
  }

  const costKrw = parseRepairCost(message.text);
  if (costKrw === null) {
    await editMessage({
      chatId: message.chat.id,
      messageId: interaction.mainMessageId,
      text: INVALID_REPAIR_COST_MESSAGE,
      replyMarkup: { inline_keyboard: [] },
    });
    return { status: "invalid_repair_cost" };
  }

  const repairLog = saveRepairLog(database, interaction, costKrw, now);

  pendingInteractions.delete(message.chat.id);
  const updated = renderUpdatedInventory(
    database,
    interaction.inventoryItemId,
    interaction.inventoryCode,
  );
  await editMessage({
    chatId: message.chat.id,
    messageId: interaction.mainMessageId,
    ...updated,
  });

  return {
    status: "repair_log_added",
    repairLogId: repairLog.id,
    inventoryItemId: interaction.inventoryItemId,
  };
}
