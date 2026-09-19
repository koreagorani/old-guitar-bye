import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { addExpense } from "../../repositories/expense-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const EXPENSE_INPUT_PROMPT = "비용 내용을 입력해주세요.\n예: 택배 4500\n취소: /cancel";
export const INVALID_EXPENSE_INPUT_MESSAGE = "비용 내용과 금액을 함께 입력해주세요.\n예: 택배 4500";
export const EXPENSE_CANCELLED_MESSAGE = "비용 추가를 취소했습니다.";
export const EXPENSE_INPUT_STEP = "AWAITING_EXPENSE_INPUT";

const krwFormatter = new Intl.NumberFormat("ko-KR");

export function parseExpenseInput(text) {
  if (typeof text !== "string") {
    return null;
  }
  const match = /^(.*?)\s+(\d+)$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const description = match[1].trim();
  const amountKrw = Number(match[2]);
  if (description === "" || !Number.isSafeInteger(amountKrw)) {
    return null;
  }
  return { description, amountKrw };
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

export async function beginExpenseFlow({
  inventory,
  callbackQuery,
  pendingInteractions,
  sendMessage,
  answerCallback,
}) {
  const chatId = callbackQuery.message.chat.id;
  pendingInteractions.set(chatId, {
    type: "expense",
    step: EXPENSE_INPUT_STEP,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    detailMessageId: callbackQuery.message.message_id,
  });
  await sendMessage({ chatId, text: EXPENSE_INPUT_PROMPT });
  await answerCallback({ callbackQueryId: callbackQuery.id });

  return {
    status: "awaiting_expense_input",
    inventoryItemId: inventory.id,
  };
}

export async function handlePendingExpenseMessage({
  database,
  message,
  pendingInteractions,
  sendMessage,
  editMessage,
  now = () => new Date(),
}) {
  const interaction = pendingInteractions.get(message.chat.id);
  if (!interaction || interaction.type !== "expense") {
    return null;
  }

  if (message.text.trim() === "/cancel") {
    pendingInteractions.delete(message.chat.id);
    await sendMessage({
      chatId: message.chat.id,
      text: EXPENSE_CANCELLED_MESSAGE,
    });
    return { status: "cancelled" };
  }

  const parsed = parseExpenseInput(message.text);
  if (parsed === null) {
    await sendMessage({
      chatId: message.chat.id,
      text: INVALID_EXPENSE_INPUT_MESSAGE,
    });
    return { status: "invalid_expense_input" };
  }

  const expense = addExpense(database, {
    inventoryItemId: interaction.inventoryItemId,
    category: "OTHER",
    amountKrw: parsed.amountKrw,
    note: parsed.description,
    occurredAt: now().toISOString(),
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
      "비용을 추가했습니다.",
      `${parsed.description} / ${krwFormatter.format(parsed.amountKrw)}원`,
    ].join("\n"),
  });

  return {
    status: "expense_added",
    expenseId: expense.id,
    inventoryItemId: interaction.inventoryItemId,
  };
}
