import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { registerInventory } from "../../application/inventory/register-inventory.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { renderAddInventoryCard } from "../render/add-inventory-card-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const ADD_STEPS = Object.freeze({
  BRAND: "AWAITING_ADD_BRAND",
  MODEL: "AWAITING_ADD_MODEL",
  GUITAR_TYPE: "AWAITING_ADD_GUITAR_TYPE",
  CUSTOM_GUITAR_TYPE: "AWAITING_ADD_CUSTOM_GUITAR_TYPE",
  PURCHASE_PRICE: "AWAITING_ADD_PURCHASE_PRICE",
  EXPECTED_SALE_PRICE: "AWAITING_ADD_EXPECTED_SALE_PRICE",
});

export const ADD_BRAND_PROMPT = "브랜드를 입력해주세요.\n예: Yamaha\n취소: /cancel";
export const ADD_MODEL_PROMPT = "모델명을 입력해주세요.\n예: F310\n취소: /cancel";
export const ADD_GUITAR_TYPE_PROMPT = "기타 종류를 선택해주세요.";
export const ADD_CUSTOM_GUITAR_TYPE_PROMPT = "기타 종류를 입력해주세요.\n취소: /cancel";
export const ADD_PURCHASE_PRICE_PROMPT = "매입가를 입력해주세요.\n예: 20000\n취소: /cancel";
export const ADD_EXPECTED_SALE_PRICE_PROMPT = "예상 판매가를 입력해주세요.\n예: 80000\n취소: /cancel";
export const INVALID_ADD_TEXT_MESSAGE = "내용을 입력해주세요.";
export const INVALID_ADD_PRICE_MESSAGE = "가격은 0 이상의 숫자로 입력해주세요.";
export const ADD_CANCELLED_MESSAGE = "기타 등록을 취소했습니다.";

const GUITAR_TYPES = Object.freeze({
  acoustic: Object.freeze({ value: "ACOUSTIC", label: "어쿠스틱" }),
  electric: Object.freeze({ value: "ELECTRIC", label: "일렉" }),
  other: Object.freeze({ value: "OTHER", label: "기타" }),
});

function cancelKeyboard() {
  return {
    inline_keyboard: [[{
      text: "등록 취소",
      callback_data: "add:cancel",
    }]],
  };
}

function guitarTypeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "어쿠스틱", callback_data: "add:guitar_type:acoustic" },
        { text: "일렉", callback_data: "add:guitar_type:electric" },
      ],
      [
        { text: "기타", callback_data: "add:guitar_type:other" },
        { text: "직접 입력", callback_data: "add:guitar_type:custom" },
      ],
      [{ text: "등록 취소", callback_data: "add:cancel" }],
    ],
  };
}

function parsePrice(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    return null;
  }
  const value = Number(text.trim());
  return Number.isSafeInteger(value) ? value : null;
}

function nonEmptyText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }
  return text.trim();
}

function sentMessageId(sentMessage) {
  const messageId = sentMessage?.message_id;
  if (!Number.isSafeInteger(messageId)) {
    throw new Error("Telegram sendMessage did not return a message_id");
  }
  return messageId;
}

async function editAddCard(editMessage, chatId, interaction, prompt, options = {}) {
  await editMessage({
    chatId,
    messageId: interaction.mainMessageId,
    text: renderAddInventoryCard({
      interaction,
      steps: ADD_STEPS,
      prompt,
      error: options.error ?? null,
    }),
    replyMarkup: options.replyMarkup ?? cancelKeyboard(),
  });
}

export async function beginAddInventoryFlow({
  chatId,
  commandMessageId,
  pendingInteractions,
  sendMessage,
  cleanupMessage,
}) {
  const interaction = {
    type: "add_inventory",
    step: ADD_STEPS.BRAND,
  };
  const sent = await sendMessage({
    chatId,
    text: renderAddInventoryCard({
      interaction,
      steps: ADD_STEPS,
      prompt: ADD_BRAND_PROMPT,
    }),
    replyMarkup: cancelKeyboard(),
  });
  const mainMessageId = sentMessageId(sent);
  pendingInteractions.set(chatId, { ...interaction, mainMessageId });
  await cleanupMessage({ chatId, messageId: commandMessageId });
  return { status: "awaiting_add_brand", mainMessageId };
}

export async function handleAddInventoryCallback({
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
}) {
  const chatId = callbackQuery?.message?.chat?.id;
  const interaction = pendingInteractions.get(chatId);
  if (callbackQuery?.data === "add:cancel" && interaction?.type === "add_inventory") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId: interaction.mainMessageId,
      text: ADD_CANCELLED_MESSAGE,
      replyMarkup: { inline_keyboard: [] },
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "cancelled" };
  }

  const match = /^add:guitar_type:(acoustic|electric|other|custom)$/.exec(
    callbackQuery?.data ?? "",
  );
  if (!match || interaction?.type !== "add_inventory"
    || interaction.step !== ADD_STEPS.GUITAR_TYPE) {
    await answerCallback({
      callbackQueryId: callbackQuery?.id,
      text: "진행 중인 기타 등록이 없습니다.",
    });
    return { status: "invalid_add_guitar_type" };
  }

  const selected = match[1];
  if (selected === "custom") {
    const updated = {
      ...interaction,
      step: ADD_STEPS.CUSTOM_GUITAR_TYPE,
    };
    pendingInteractions.set(chatId, updated);
    await editAddCard(
      editMessage,
      chatId,
      updated,
      ADD_CUSTOM_GUITAR_TYPE_PROMPT,
    );
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "awaiting_add_custom_guitar_type" };
  }

  const guitarType = GUITAR_TYPES[selected];
  const updated = {
    ...interaction,
    step: ADD_STEPS.PURCHASE_PRICE,
    guitarType: guitarType.value,
    guitarTypeLabel: guitarType.label,
  };
  pendingInteractions.set(chatId, updated);
  await editAddCard(editMessage, chatId, updated, ADD_PURCHASE_PRICE_PROMPT);
  await answerCallback({ callbackQueryId: callbackQuery.id });
  return { status: "awaiting_add_purchase_price" };
}

export async function handlePendingAddInventoryMessage({
  database,
  message,
  pendingInteractions,
  editMessage,
  cleanupMessage,
  now = () => new Date(),
}) {
  const chatId = message.chat.id;
  const interaction = pendingInteractions.get(chatId);
  if (!interaction || interaction.type !== "add_inventory") {
    return null;
  }

  await cleanupMessage({ chatId, messageId: message.message_id });

  if (message.text.trim() === "/cancel") {
    pendingInteractions.delete(chatId);
    await editMessage({
      chatId,
      messageId: interaction.mainMessageId,
      text: ADD_CANCELLED_MESSAGE,
      replyMarkup: { inline_keyboard: [] },
    });
    return { status: "cancelled" };
  }

  if (interaction.step === ADD_STEPS.BRAND) {
    const brand = nonEmptyText(message.text);
    if (brand === null) {
      await editAddCard(editMessage, chatId, interaction, ADD_BRAND_PROMPT, {
        error: INVALID_ADD_TEXT_MESSAGE,
      });
      return { status: "invalid_add_brand" };
    }
    const updated = { ...interaction, step: ADD_STEPS.MODEL, brand };
    pendingInteractions.set(chatId, updated);
    await editAddCard(editMessage, chatId, updated, ADD_MODEL_PROMPT);
    return { status: "awaiting_add_model" };
  }

  if (interaction.step === ADD_STEPS.MODEL) {
    const modelName = nonEmptyText(message.text);
    if (modelName === null) {
      await editAddCard(editMessage, chatId, interaction, ADD_MODEL_PROMPT, {
        error: INVALID_ADD_TEXT_MESSAGE,
      });
      return { status: "invalid_add_model" };
    }
    const updated = {
      ...interaction,
      step: ADD_STEPS.GUITAR_TYPE,
      modelName,
    };
    pendingInteractions.set(chatId, updated);
    await editAddCard(editMessage, chatId, updated, ADD_GUITAR_TYPE_PROMPT, {
      replyMarkup: guitarTypeKeyboard(),
    });
    return { status: "awaiting_add_guitar_type" };
  }

  if (interaction.step === ADD_STEPS.GUITAR_TYPE) {
    await editAddCard(editMessage, chatId, interaction, ADD_GUITAR_TYPE_PROMPT, {
      replyMarkup: guitarTypeKeyboard(),
    });
    return { status: "awaiting_add_guitar_type" };
  }

  if (interaction.step === ADD_STEPS.CUSTOM_GUITAR_TYPE) {
    const guitarType = nonEmptyText(message.text);
    if (guitarType === null) {
      await editAddCard(
        editMessage,
        chatId,
        interaction,
        ADD_CUSTOM_GUITAR_TYPE_PROMPT,
        { error: INVALID_ADD_TEXT_MESSAGE },
      );
      return { status: "invalid_add_guitar_type" };
    }
    const updated = {
      ...interaction,
      step: ADD_STEPS.PURCHASE_PRICE,
      guitarType,
      guitarTypeLabel: guitarType,
    };
    pendingInteractions.set(chatId, updated);
    await editAddCard(editMessage, chatId, updated, ADD_PURCHASE_PRICE_PROMPT);
    return { status: "awaiting_add_purchase_price" };
  }

  if (interaction.step === ADD_STEPS.PURCHASE_PRICE) {
    const purchasePriceKrw = parsePrice(message.text);
    if (purchasePriceKrw === null) {
      await editAddCard(
        editMessage,
        chatId,
        interaction,
        ADD_PURCHASE_PRICE_PROMPT,
        { error: INVALID_ADD_PRICE_MESSAGE },
      );
      return { status: "invalid_add_purchase_price" };
    }
    const updated = {
      ...interaction,
      step: ADD_STEPS.EXPECTED_SALE_PRICE,
      purchasePriceKrw,
    };
    pendingInteractions.set(chatId, updated);
    await editAddCard(
      editMessage,
      chatId,
      updated,
      ADD_EXPECTED_SALE_PRICE_PROMPT,
    );
    return { status: "awaiting_add_expected_sale_price" };
  }

  if (interaction.step !== ADD_STEPS.EXPECTED_SALE_PRICE) {
    throw new Error(`Unknown add inventory step: ${interaction.step}`);
  }

  const expectedSalePriceKrw = parsePrice(message.text);
  if (expectedSalePriceKrw === null) {
    await editAddCard(
      editMessage,
      chatId,
      interaction,
      ADD_EXPECTED_SALE_PRICE_PROMPT,
      { error: INVALID_ADD_PRICE_MESSAGE },
    );
    return { status: "invalid_add_expected_sale_price" };
  }

  const inventory = registerInventory(database, {
    brand: interaction.brand,
    modelName: interaction.modelName,
    guitarType: interaction.guitarType,
    purchasePriceKrw: interaction.purchasePriceKrw,
    expectedSalePriceKrw,
    registeredAt: now().toISOString(),
  });
  pendingInteractions.delete(chatId);
  const detail = getInventoryDetail(database, inventory.id);
  await editMessage({
    chatId,
    messageId: interaction.mainMessageId,
    text: renderInventoryDetail(detail),
    replyMarkup: buildInventoryInlineKeyboard(
      renderInventoryActions(detail.inventory.state),
      inventory.inventoryCode,
    ),
  });
  return { status: "inventory_added", inventoryItemId: inventory.id };
}
