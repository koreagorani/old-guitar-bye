import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import {
  updateExpenseRecord,
  updateRepairRecord,
} from "../../application/inventory/update-inventory-record.js";
import { findInventoryItemByCode } from "../../repositories/inventory-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";
import { EXPENSE_TYPES } from "./expense-flow.js";

export const RECORD_EDIT_STEPS = Object.freeze({
  REPAIR_TYPE: "AWAITING_REPAIR_EDIT_TYPE",
  REPAIR_COST: "AWAITING_REPAIR_EDIT_COST",
  EXPENSE_AMOUNT: "AWAITING_EXPENSE_EDIT_AMOUNT",
});

export const RECORD_EDIT_PROMPTS = Object.freeze({
  repair_type: "새 수리 내용을 입력해주세요.\n취소: /cancel",
  repair_cost: "새 수리 비용을 입력해주세요.\n예: 8000\n취소: /cancel",
  expense_type: "새 비용 종류를 선택해주세요.",
  expense_amount: "새 비용 금액을 입력해주세요.\n예: 4500\n취소: /cancel",
});

const krwFormatter = new Intl.NumberFormat("ko-KR");

function parseAmount(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    return null;
  }
  const value = Number(text.trim());
  return Number.isSafeInteger(value) ? value : null;
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

function recordsFor(detail, kind) {
  return kind === "repair" ? detail.repairs : detail.expenses;
}

function recordLabel(kind, record) {
  if (kind === "repair") {
    return `#${record.id} ${record.type} / ${krwFormatter.format(record.costKrw)}원`;
  }
  const label = typeof record.note === "string" && record.note.trim() !== ""
    ? record.note
    : record.category;
  return `#${record.id} ${label} / ${krwFormatter.format(record.amountKrw)}원`;
}

function recordListKeyboard(kind, detail) {
  const inventoryCode = detail.inventory.inventoryCode;
  const rows = recordsFor(detail, kind).map((record) => [{
    text: recordLabel(kind, record),
    callback_data: `record:${kind}:select:${record.id}:${inventoryCode}`,
  }]);
  rows.push([{
    text: "뒤로",
    callback_data: `record:${kind}:detail:0:${inventoryCode}`,
  }]);
  return { inline_keyboard: rows };
}

function selectedRecordKeyboard(kind, recordId, inventoryCode) {
  const fields = kind === "repair"
    ? [
      { text: "내용 수정", action: "type" },
      { text: "비용 수정", action: "cost" },
    ]
    : [
      { text: "종류 수정", action: "type" },
      { text: "금액 수정", action: "amount" },
    ];
  return {
    inline_keyboard: [
      fields.map(({ text, action }) => ({
        text,
        callback_data: `record:${kind}:${action}:${recordId}:${inventoryCode}`,
      })),
      [{
        text: "뒤로",
        callback_data: `record:${kind}:list:0:${inventoryCode}`,
      }],
    ],
  };
}

function expenseTypeKeyboard(expenseId, inventoryCode) {
  return {
    inline_keyboard: [
      [
        { text: "택배", key: "delivery" },
        { text: "교통비", key: "transport" },
        { text: "기타", key: "other" },
      ].map(({ text, key }) => ({
        text,
        callback_data: `record:expense:set_${key}:${expenseId}:${inventoryCode}`,
      })),
      [{
        text: "뒤로",
        callback_data: `record:expense:select:${expenseId}:${inventoryCode}`,
      }],
    ],
  };
}

export function parseRecordEditCallbackData(callbackData) {
  if (typeof callbackData !== "string") {
    return null;
  }
  const match = /^record:(repair|expense):([a-z_]+):(\d+):(G-\d{4})$/.exec(
    callbackData,
  );
  if (!match) {
    return null;
  }
  const [, kind, action, rawRecordId, inventoryCode] = match;
  const repairActions = new Set(["select", "type", "cost", "list", "detail"]);
  const expenseActions = new Set([
    "select",
    "type",
    "amount",
    "list",
    "detail",
    "set_delivery",
    "set_transport",
    "set_other",
  ]);
  if (!(kind === "repair" ? repairActions : expenseActions).has(action)) {
    return null;
  }
  const recordId = Number(rawRecordId);
  if (!Number.isSafeInteger(recordId) || recordId < 0) {
    return null;
  }
  return { kind, action, recordId, inventoryCode };
}

function findOwnedRecord(detail, kind, recordId) {
  return recordsFor(detail, kind).find(({ id }) => id === recordId) ?? null;
}

async function showRecordList({
  database,
  inventory,
  kind,
  chatId,
  messageId,
  editMessage,
}) {
  const detail = getInventoryDetail(database, inventory.id);
  const records = recordsFor(detail, kind);
  await editMessage({
    chatId,
    messageId,
    text: records.length === 0
      ? "수정할 기록이 없습니다."
      : kind === "repair"
        ? "수정할 수리 기록을 선택해주세요."
        : "수정할 비용 기록을 선택해주세요.",
    replyMarkup: recordListKeyboard(kind, detail),
  });
  return records.length;
}

export async function beginRecordEditList({
  database,
  inventory,
  kind,
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
}) {
  pendingInteractions.delete(callbackQuery.message.chat.id);
  const count = await showRecordList({
    database,
    inventory,
    kind,
    chatId: callbackQuery.message.chat.id,
    messageId: callbackQuery.message.message_id,
    editMessage,
  });
  await answerCallback({ callbackQueryId: callbackQuery.id });
  return {
    status: count === 0 ? "no_records" : `${kind}_record_list`,
    inventoryItemId: inventory.id,
  };
}

export async function handleRecordEditCallback({
  database,
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
}) {
  const parsed = parseRecordEditCallbackData(callbackQuery?.data);
  if (!parsed) {
    await answerCallback({
      callbackQueryId: callbackQuery?.id,
      text: "올바르지 않은 기록 수정 작업입니다.",
    });
    return { status: "invalid" };
  }

  const inventory = findInventoryItemByCode(database, parsed.inventoryCode);
  if (!inventory) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: "해당 재고를 찾을 수 없습니다.",
    });
    return { status: "not_found" };
  }

  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const detail = getInventoryDetail(database, inventory.id);

  if (parsed.action === "detail") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId,
      ...renderUpdatedInventory(database, inventory.id, inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "record_edit_closed" };
  }

  if (parsed.action === "list") {
    pendingInteractions.delete(chatId);
    await showRecordList({
      database,
      inventory,
      kind: parsed.kind,
      chatId,
      messageId,
      editMessage,
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: `${parsed.kind}_record_list` };
  }

  const record = findOwnedRecord(detail, parsed.kind, parsed.recordId);
  if (!record) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: "수정할 기록을 찾을 수 없습니다.",
    });
    return { status: "record_not_found" };
  }

  if (parsed.action === "select") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId,
      text: [
        parsed.kind === "repair" ? "수리 기록 수정" : "비용 기록 수정",
        recordLabel(parsed.kind, record),
        "",
        "수정할 항목을 선택해주세요.",
      ].join("\n"),
      replyMarkup: selectedRecordKeyboard(
        parsed.kind,
        record.id,
        inventory.inventoryCode,
      ),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: `${parsed.kind}_record_selected`, recordId: record.id };
  }

  if (parsed.kind === "expense" && parsed.action.startsWith("set_")) {
    const key = parsed.action.slice(4);
    const selected = EXPENSE_TYPES[key];
    if (!selected) {
      await answerCallback({
        callbackQueryId: callbackQuery.id,
        text: "올바르지 않은 비용 종류입니다.",
      });
      return { status: "invalid" };
    }
    updateExpenseRecord(database, inventory.id, record.id, {
      category: selected.category,
      note: selected.label,
    });
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId,
      ...renderUpdatedInventory(database, inventory.id, inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "expense_record_updated", expenseId: record.id };
  }

  if (parsed.kind === "expense" && parsed.action === "type") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId,
      text: RECORD_EDIT_PROMPTS.expense_type,
      replyMarkup: expenseTypeKeyboard(record.id, inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "awaiting_expense_type_choice", expenseId: record.id };
  }

  const step = parsed.kind === "repair"
    ? (parsed.action === "type"
      ? RECORD_EDIT_STEPS.REPAIR_TYPE
      : RECORD_EDIT_STEPS.REPAIR_COST)
    : RECORD_EDIT_STEPS.EXPENSE_AMOUNT;
  const promptKey = parsed.kind === "repair"
    ? (parsed.action === "type" ? "repair_type" : "repair_cost")
    : "expense_amount";
  pendingInteractions.set(chatId, {
    type: "record_edit",
    step,
    kind: parsed.kind,
    recordId: record.id,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    mainMessageId: messageId,
  });
  await editMessage({
    chatId,
    messageId,
    text: RECORD_EDIT_PROMPTS[promptKey],
    replyMarkup: { inline_keyboard: [] },
  });
  await answerCallback({ callbackQueryId: callbackQuery.id });
  return { status: `awaiting_${parsed.kind}_record_input`, recordId: record.id };
}

export async function handlePendingRecordEditMessage({
  database,
  message,
  pendingInteractions,
  editMessage,
  cleanupMessage,
}) {
  const interaction = pendingInteractions.get(message.chat.id);
  if (!interaction || interaction.type !== "record_edit") {
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

  let changes;
  let invalidMessage;
  if (interaction.step === RECORD_EDIT_STEPS.REPAIR_TYPE) {
    const type = message.text.trim();
    if (type === "") {
      invalidMessage = "수리 내용은 비워둘 수 없습니다.";
    } else {
      changes = { type };
    }
  } else {
    const amount = parseAmount(message.text);
    if (amount === null) {
      invalidMessage = "금액은 0 이상의 숫자로 입력해주세요.";
    } else if (interaction.step === RECORD_EDIT_STEPS.REPAIR_COST) {
      changes = { costKrw: amount };
    } else if (interaction.step === RECORD_EDIT_STEPS.EXPENSE_AMOUNT) {
      changes = { amountKrw: amount };
    } else {
      throw new Error(`Unknown record edit step: ${interaction.step}`);
    }
  }

  if (!changes) {
    await editMessage({
      chatId: message.chat.id,
      messageId: interaction.mainMessageId,
      text: invalidMessage,
      replyMarkup: { inline_keyboard: [] },
    });
    return { status: "invalid_record_edit_input" };
  }

  if (interaction.kind === "repair") {
    updateRepairRecord(
      database,
      interaction.inventoryItemId,
      interaction.recordId,
      changes,
    );
  } else {
    updateExpenseRecord(
      database,
      interaction.inventoryItemId,
      interaction.recordId,
      changes,
    );
  }

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
  return {
    status: `${interaction.kind}_record_updated`,
    recordId: interaction.recordId,
  };
}
