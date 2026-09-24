import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { findInventoryItemByCode } from "../../repositories/inventory-repository.js";
import { addExpense } from "../../repositories/expense-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const EXPENSE_INPUT_PROMPT = "비용 내용을 입력해주세요.\n예: 택배 4500\n취소: /cancel";
export const INVALID_EXPENSE_INPUT_MESSAGE = "비용 내용과 금액을 함께 입력해주세요.\n예: 택배 4500";
export const EXPENSE_CANCELLED_MESSAGE = "비용 추가를 취소했습니다.";
export const EXPENSE_INPUT_STEP = "AWAITING_EXPENSE_INPUT";
export const EXPENSE_AMOUNT_INPUT_STEP = "AWAITING_EXPENSE_AMOUNT";
export const EXPENSE_MENU_PROMPT = "비용 종류를 선택해주세요.";
export const EXPENSE_AMOUNT_MENU_PROMPT = "금액을 선택해주세요.";
export const EXPENSE_AMOUNT_INPUT_PROMPT = "비용을 입력해주세요.\n예: 4500\n취소: /cancel";
export const INVALID_EXPENSE_AMOUNT_MESSAGE = "비용은 0 이상의 숫자로 입력해주세요.";
export const NO_PENDING_EXPENSE_MESSAGE = "진행 중인 비용 입력이 없습니다.";

const EXPENSE_TYPES = Object.freeze({
  delivery: Object.freeze({ label: "택배", category: "LOGISTICS" }),
  transport: Object.freeze({ label: "교통비", category: "LOGISTICS" }),
  other: Object.freeze({ label: "기타", category: "OTHER" }),
});

function expenseTypeKeyboard(inventoryCode) {
  return {
    inline_keyboard: [
      [
        { text: "택배", callback_data: `expense:type:delivery:${inventoryCode}` },
        { text: "교통비", callback_data: `expense:type:transport:${inventoryCode}` },
      ],
      [{ text: "기타", callback_data: `expense:type:other:${inventoryCode}` }],
      [{ text: "뒤로", callback_data: `expense:back:detail:${inventoryCode}` }],
    ],
  };
}

function expenseAmountKeyboard(inventoryCode) {
  return {
    inline_keyboard: [
      [
        { text: "0원", callback_data: `expense:amount:zero:${inventoryCode}` },
        { text: "직접 입력", callback_data: `expense:amount:custom:${inventoryCode}` },
      ],
      [{ text: "뒤로", callback_data: `expense:back:types:${inventoryCode}` }],
    ],
  };
}

export function parseExpenseCallbackData(callbackData) {
  if (typeof callbackData !== "string") {
    return null;
  }
  const match = /^expense:(type|amount|back):([a-z_]+):(G-\d{4})$/.exec(callbackData);
  if (!match) {
    return null;
  }
  const [, action, value, inventoryCode] = match;
  const valid = (action === "type" && Object.hasOwn(EXPENSE_TYPES, value))
    || (action === "amount" && (value === "zero" || value === "custom"))
    || (action === "back" && (value === "types" || value === "detail"));
  return valid ? { action, value, inventoryCode } : null;
}

function parseExpenseAmount(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    return null;
  }
  const amount = Number(text.trim());
  return Number.isSafeInteger(amount) ? amount : null;
}

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

function saveExpense(database, interaction, amountKrw, now) {
  return addExpense(database, {
    inventoryItemId: interaction.inventoryItemId,
    category: interaction.category,
    amountKrw,
    note: interaction.description,
    occurredAt: now().toISOString(),
  });
}

export async function beginExpenseMenu({
  inventory,
  callbackQuery,
  editMessage,
  answerCallback,
}) {
  await editMessage({
    chatId: callbackQuery.message.chat.id,
    messageId: callbackQuery.message.message_id,
    text: EXPENSE_MENU_PROMPT,
    replyMarkup: expenseTypeKeyboard(inventory.inventoryCode),
  });
  await answerCallback({ callbackQueryId: callbackQuery.id });
  return { status: "expense_menu", inventoryItemId: inventory.id };
}

export async function handleExpenseMenuCallback({
  database,
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
  now = () => new Date(),
}) {
  const parsed = parseExpenseCallbackData(callbackQuery?.data);
  if (!parsed) {
    await answerCallback({
      callbackQueryId: callbackQuery?.id,
      text: "올바르지 않은 비용 작업입니다.",
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
    return { status: "expense_menu_closed" };
  }

  if (parsed.action === "back" && parsed.value === "types") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId,
      text: EXPENSE_MENU_PROMPT,
      replyMarkup: expenseTypeKeyboard(inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "expense_menu" };
  }

  if (parsed.action === "type") {
    const selected = EXPENSE_TYPES[parsed.value];
    pendingInteractions.set(chatId, {
      type: "expense",
      step: EXPENSE_AMOUNT_INPUT_STEP,
      category: selected.category,
      description: selected.label,
      inventoryItemId: inventory.id,
      inventoryCode: inventory.inventoryCode,
      mainMessageId: messageId,
    });
    await editMessage({
      chatId,
      messageId,
      text: `${selected.label}\n${EXPENSE_AMOUNT_MENU_PROMPT}`,
      replyMarkup: expenseAmountKeyboard(inventory.inventoryCode),
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return {
      status: "awaiting_expense_amount_choice",
      expenseType: selected.label,
    };
  }

  const interaction = pendingInteractions.get(chatId);
  if (!interaction || interaction.type !== "expense"
    || interaction.step !== EXPENSE_AMOUNT_INPUT_STEP
    || interaction.inventoryCode !== inventory.inventoryCode) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: NO_PENDING_EXPENSE_MESSAGE,
    });
    return { status: "no_pending_expense" };
  }

  if (parsed.value === "custom") {
    await editMessage({
      chatId,
      messageId,
      text: EXPENSE_AMOUNT_INPUT_PROMPT,
      replyMarkup: { inline_keyboard: [[{
        text: "뒤로",
        callback_data: `expense:back:types:${inventory.inventoryCode}`,
      }]] },
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "awaiting_expense_amount" };
  }

  const expense = saveExpense(database, interaction, 0, now);
  pendingInteractions.delete(chatId);
  await editMessage({
    chatId,
    messageId,
    ...renderUpdatedInventory(database, inventory.id, inventory.inventoryCode),
  });
  await answerCallback({
    callbackQueryId: callbackQuery.id,
    text: `${interaction.description} / 0원 저장했습니다.`,
  });
  return {
    status: "expense_added",
    expenseId: expense.id,
    inventoryItemId: inventory.id,
  };
}

export async function beginExpenseFlow({
  inventory,
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
}) {
  const chatId = callbackQuery.message.chat.id;
  pendingInteractions.set(chatId, {
    type: "expense",
    step: EXPENSE_INPUT_STEP,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    mainMessageId: callbackQuery.message.message_id,
  });
  await editMessage({
    chatId,
    messageId: callbackQuery.message.message_id,
    text: EXPENSE_INPUT_PROMPT,
    replyMarkup: { inline_keyboard: [] },
  });
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
  editMessage,
  cleanupMessage,
  now = () => new Date(),
}) {
  const interaction = pendingInteractions.get(message.chat.id);
  if (!interaction || interaction.type !== "expense") {
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

  const isAmountOnly = interaction.step === EXPENSE_AMOUNT_INPUT_STEP;
  const amount = isAmountOnly ? parseExpenseAmount(message.text) : null;
  const parsed = isAmountOnly
    ? (amount === null ? null : {
      description: interaction.description,
      category: interaction.category,
      amountKrw: amount,
    })
    : parseExpenseInput(message.text);
  if (parsed === null) {
    await editMessage({
      chatId: message.chat.id,
      messageId: interaction.mainMessageId,
      text: isAmountOnly
        ? INVALID_EXPENSE_AMOUNT_MESSAGE
        : INVALID_EXPENSE_INPUT_MESSAGE,
      replyMarkup: { inline_keyboard: [] },
    });
    return { status: "invalid_expense_input" };
  }

  const expense = saveExpense(database, {
    ...interaction,
    category: parsed.category ?? "OTHER",
    description: parsed.description,
  }, parsed.amountKrw, now);

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
    status: "expense_added",
    expenseId: expense.id,
    inventoryItemId: interaction.inventoryItemId,
  };
}
