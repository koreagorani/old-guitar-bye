import { registerInventory } from "../../application/inventory/register-inventory.js";

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
  acoustic: "ACOUSTIC",
  electric: "ELECTRIC",
  other: "OTHER",
});

const krwFormatter = new Intl.NumberFormat("ko-KR");

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

export async function beginAddInventoryFlow({
  chatId,
  pendingInteractions,
  sendMessage,
}) {
  pendingInteractions.set(chatId, {
    type: "add_inventory",
    step: ADD_STEPS.BRAND,
  });
  await sendMessage({ chatId, text: ADD_BRAND_PROMPT });
  return { status: "awaiting_add_brand" };
}

export async function handleAddInventoryCallback({
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
}) {
  const match = /^add:guitar_type:(acoustic|electric|other|custom)$/.exec(
    callbackQuery?.data ?? "",
  );
  const chatId = callbackQuery?.message?.chat?.id;
  const interaction = pendingInteractions.get(chatId);
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
    pendingInteractions.set(chatId, {
      ...interaction,
      step: ADD_STEPS.CUSTOM_GUITAR_TYPE,
    });
    await editMessage({
      chatId,
      messageId: callbackQuery.message.message_id,
      text: ADD_CUSTOM_GUITAR_TYPE_PROMPT,
      replyMarkup: { inline_keyboard: [] },
    });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "awaiting_add_custom_guitar_type" };
  }

  pendingInteractions.set(chatId, {
    ...interaction,
    step: ADD_STEPS.PURCHASE_PRICE,
    guitarType: GUITAR_TYPES[selected],
  });
  await editMessage({
    chatId,
    messageId: callbackQuery.message.message_id,
    text: ADD_PURCHASE_PRICE_PROMPT,
    replyMarkup: { inline_keyboard: [] },
  });
  await answerCallback({ callbackQueryId: callbackQuery.id });
  return { status: "awaiting_add_purchase_price" };
}

export async function handlePendingAddInventoryMessage({
  database,
  message,
  pendingInteractions,
  sendMessage,
  now = () => new Date(),
}) {
  const chatId = message.chat.id;
  const interaction = pendingInteractions.get(chatId);
  if (!interaction || interaction.type !== "add_inventory") {
    return null;
  }

  if (message.text.trim() === "/cancel") {
    pendingInteractions.delete(chatId);
    await sendMessage({ chatId, text: ADD_CANCELLED_MESSAGE });
    return { status: "cancelled" };
  }

  if (interaction.step === ADD_STEPS.BRAND) {
    const brand = nonEmptyText(message.text);
    if (brand === null) {
      await sendMessage({ chatId, text: INVALID_ADD_TEXT_MESSAGE });
      return { status: "invalid_add_brand" };
    }
    pendingInteractions.set(chatId, {
      ...interaction,
      step: ADD_STEPS.MODEL,
      brand,
    });
    await sendMessage({ chatId, text: ADD_MODEL_PROMPT });
    return { status: "awaiting_add_model" };
  }

  if (interaction.step === ADD_STEPS.MODEL) {
    const modelName = nonEmptyText(message.text);
    if (modelName === null) {
      await sendMessage({ chatId, text: INVALID_ADD_TEXT_MESSAGE });
      return { status: "invalid_add_model" };
    }
    pendingInteractions.set(chatId, {
      ...interaction,
      step: ADD_STEPS.GUITAR_TYPE,
      modelName,
    });
    await sendMessage({
      chatId,
      text: ADD_GUITAR_TYPE_PROMPT,
      replyMarkup: guitarTypeKeyboard(),
    });
    return { status: "awaiting_add_guitar_type" };
  }

  if (interaction.step === ADD_STEPS.GUITAR_TYPE) {
    await sendMessage({
      chatId,
      text: ADD_GUITAR_TYPE_PROMPT,
      replyMarkup: guitarTypeKeyboard(),
    });
    return { status: "awaiting_add_guitar_type" };
  }

  if (interaction.step === ADD_STEPS.CUSTOM_GUITAR_TYPE) {
    const guitarType = nonEmptyText(message.text);
    if (guitarType === null) {
      await sendMessage({ chatId, text: INVALID_ADD_TEXT_MESSAGE });
      return { status: "invalid_add_guitar_type" };
    }
    pendingInteractions.set(chatId, {
      ...interaction,
      step: ADD_STEPS.PURCHASE_PRICE,
      guitarType,
    });
    await sendMessage({ chatId, text: ADD_PURCHASE_PRICE_PROMPT });
    return { status: "awaiting_add_purchase_price" };
  }

  if (interaction.step === ADD_STEPS.PURCHASE_PRICE) {
    const purchasePriceKrw = parsePrice(message.text);
    if (purchasePriceKrw === null) {
      await sendMessage({ chatId, text: INVALID_ADD_PRICE_MESSAGE });
      return { status: "invalid_add_purchase_price" };
    }
    pendingInteractions.set(chatId, {
      ...interaction,
      step: ADD_STEPS.EXPECTED_SALE_PRICE,
      purchasePriceKrw,
    });
    await sendMessage({ chatId, text: ADD_EXPECTED_SALE_PRICE_PROMPT });
    return { status: "awaiting_add_expected_sale_price" };
  }

  if (interaction.step !== ADD_STEPS.EXPECTED_SALE_PRICE) {
    throw new Error(`Unknown add inventory step: ${interaction.step}`);
  }

  const expectedSalePriceKrw = parsePrice(message.text);
  if (expectedSalePriceKrw === null) {
    await sendMessage({ chatId, text: INVALID_ADD_PRICE_MESSAGE });
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
  await sendMessage({
    chatId,
    text: [
      `🎸 ${inventory.brand} ${inventory.modelName} 등록 완료`,
      "",
      `재고번호: ${inventory.inventoryCode}`,
      `매입가: ${krwFormatter.format(inventory.purchasePriceKrw)}원`,
      `예상 판매가: ${krwFormatter.format(inventory.expectedSalePriceKrw)}원`,
      "상태: 재고 보유",
    ].join("\n"),
    replyMarkup: { inline_keyboard: [[{
      text: "상세 보기",
      callback_data: `inventory:open:${inventory.inventoryCode}`,
    }]] },
  });
  return { status: "inventory_added", inventoryItemId: inventory.id };
}
