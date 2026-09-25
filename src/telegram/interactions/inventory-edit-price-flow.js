import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import {
  updateExpectedSalePrice,
  updatePurchasePrice,
} from "../../application/inventory/update-inventory-price.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const EDIT_PRICE_FIELDS = Object.freeze({
  PURCHASE: "purchase_price",
  EXPECTED_SALE: "expected_sale_price",
});

export const PURCHASE_PRICE_INPUT_PROMPT =
  "새 매입가를 입력해주세요.\n예: 40000\n취소: /cancel";
export const EXPECTED_SALE_PRICE_INPUT_PROMPT =
  "새 예상 판매가를 입력해주세요.\n예: 90000\n취소: /cancel";
export const INVALID_EDIT_PRICE_MESSAGE =
  "금액은 0 이상의 숫자로 입력해주세요.";

function parsePrice(text) {
  if (typeof text !== "string" || !/^\\d+$/.test(text.trim())) {
    return null;
  }
  const price = Number(text.trim());
  return Number.isSafeInteger(price) ? price : null;
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

function promptForField(field) {
  if (field === EDIT_PRICE_FIELDS.PURCHASE) {
    return PURCHASE_PRICE_INPUT_PROMPT;
  }
  if (field === EDIT_PRICE_FIELDS.EXPECTED_SALE) {
    return EXPECTED_SALE_PRICE_INPUT_PROMPT;
  }
  throw new TypeError(`Unsupported edit price field: ${field}`);
}

export async function beginInventoryPriceEditFlow({
  inventory,
  field,
  callbackQuery,
  pendingInteractions,
  editMessage,
  answerCallback,
}) {
  const chatId = callbackQuery.message.chat.id;
  pendingInteractions.set(chatId, {
    type: "edit_price",
    field,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    mainMessageId: callbackQuery.message.message_id,
  });
  await editMessage({
    chatId,
    messageId: callbackQuery.message.message_id,
    text: promptForField(field),
    replyMarkup: { inline_keyboard: [] },
  });
  await answerCallback({ callbackQueryId: callbackQuery.id });

  return {
    status: "awaiting_edit_price",
    field,
    inventoryItemId: inventory.id,
  };
}

export async function handlePendingInventoryPriceEditMessage({
  database,
  message,
  pendingInteractions,
  editMessage,
  cleanupMessage,
}) {
  const interaction = pendingInteractions.get(message.chat.id);
  if (!interaction || interaction.type !== "edit_price") {
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

  const priceKrw = parsePrice(message.text);
  if (priceKrw === null) {
    await editMessage({
      chatId: message.chat.id,
      messageId: interaction.mainMessageId,
      text: INVALID_EDIT_PRICE_MESSAGE,
      replyMarkup: { inline_keyboard: [] },
    });
    return { status: "invalid_edit_price" };
  }

  if (interaction.field === EDIT_PRICE_FIELDS.PURCHASE) {
    updatePurchasePrice(database, interaction.inventoryItemId, priceKrw);
  } else if (interaction.field === EDIT_PRICE_FIELDS.EXPECTED_SALE) {
    updateExpectedSalePrice(database, interaction.inventoryItemId, priceKrw);
  } else {
    throw new TypeError(`Unsupported edit price field: ${interaction.field}`);
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
    status: "price_updated",
    field: interaction.field,
    inventoryItemId: interaction.inventoryItemId,
    priceKrw,
  };
}
