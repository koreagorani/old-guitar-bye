import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { completeSale } from "../../application/sales/complete-sale.js";
import { listSaleListingsByInventoryItemId } from "../../repositories/sale-listing-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const SALE_PRICE_PROMPT = "판매가를 입력해주세요.\n예: 75000\n취소: /cancel";
export const INVALID_SALE_PRICE_MESSAGE = "판매가는 0 이상의 숫자로 입력해주세요.";
export const SALE_MARKETPLACE_PROMPT = "판매처를 선택해주세요.";
export const SALE_CANCELLED_MESSAGE = "판매 완료 입력을 취소했습니다.";
export const NO_PENDING_SALE_MESSAGE = "진행 중인 판매 입력이 없습니다.";
export const SALE_FAILED_MESSAGE = "현재 상태에서는 판매를 완료할 수 없습니다.";

export const SALE_INPUT_STEPS = Object.freeze({
  PRICE: "AWAITING_SALE_PRICE",
  MARKETPLACE: "AWAITING_SALE_MARKETPLACE",
});

const MARKETPLACES = Object.freeze({
  DAANGN: Object.freeze({ value: "daangn", label: "당근" }),
  BUNJANG: Object.freeze({ value: "bunjang", label: "번개장터" }),
  JOONGGONARA: Object.freeze({ value: "joonggonara", label: "중고나라" }),
  DIRECT: Object.freeze({ value: "direct", label: "직거래" }),
  OTHER: Object.freeze({ value: "other", label: "기타" }),
});

const krwFormatter = new Intl.NumberFormat("ko-KR");

function saleMarketplaceKeyboard() {
  const button = ([id, marketplace]) => ({
    text: marketplace.label,
    callback_data: `sale:marketplace:${id}`,
  });
  const entries = Object.entries(MARKETPLACES);
  return {
    inline_keyboard: [
      entries.slice(0, 2).map(button),
      entries.slice(2, 4).map(button),
      entries.slice(4).map(button),
    ],
  };
}

function parseSalePrice(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    return null;
  }
  const price = Number(text.trim());
  return Number.isSafeInteger(price) ? price : null;
}

export function parseSaleMarketplaceCallbackData(callbackData) {
  if (typeof callbackData !== "string") {
    return null;
  }
  const match = /^sale:marketplace:([A-Z]+)$/.exec(callbackData);
  if (!match || !Object.hasOwn(MARKETPLACES, match[1])) {
    return null;
  }
  return MARKETPLACES[match[1]];
}

function matchingSaleListing(database, inventoryItemId, marketplace) {
  return listSaleListingsByInventoryItemId(database, inventoryItemId)
    .find((listing) => (
      listing.closedAt === null
      && listing.marketplace.toLowerCase() === marketplace
    )) ?? null;
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

export async function beginCompleteSaleFlow({
  inventory,
  callbackQuery,
  pendingInteractions,
  sendMessage,
  answerCallback,
}) {
  if (inventory.state !== "FOR_SALE") {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: SALE_FAILED_MESSAGE,
    });
    return {
      status: "invalid_state",
      action: "complete_sale",
      inventoryCode: inventory.inventoryCode,
    };
  }

  const chatId = callbackQuery.message.chat.id;
  pendingInteractions.set(chatId, {
    type: "complete_sale",
    step: SALE_INPUT_STEPS.PRICE,
    inventoryItemId: inventory.id,
    inventoryCode: inventory.inventoryCode,
    detailMessageId: callbackQuery.message.message_id,
  });
  await sendMessage({ chatId, text: SALE_PRICE_PROMPT });
  await answerCallback({ callbackQueryId: callbackQuery.id });

  return {
    status: "awaiting_sale_price",
    inventoryItemId: inventory.id,
  };
}

export async function handlePendingSaleMessage({
  message,
  pendingInteractions,
  sendMessage,
}) {
  const interaction = pendingInteractions.get(message.chat.id);
  if (!interaction || interaction.type !== "complete_sale") {
    return null;
  }

  if (message.text.trim() === "/cancel") {
    pendingInteractions.delete(message.chat.id);
    await sendMessage({ chatId: message.chat.id, text: SALE_CANCELLED_MESSAGE });
    return { status: "cancelled" };
  }

  if (interaction.step !== SALE_INPUT_STEPS.PRICE) {
    await sendMessage({
      chatId: message.chat.id,
      text: SALE_MARKETPLACE_PROMPT,
      replyMarkup: saleMarketplaceKeyboard(),
    });
    return { status: "awaiting_sale_marketplace" };
  }

  const salePriceKrw = parseSalePrice(message.text);
  if (salePriceKrw === null) {
    await sendMessage({
      chatId: message.chat.id,
      text: INVALID_SALE_PRICE_MESSAGE,
    });
    return { status: "invalid_sale_price" };
  }

  pendingInteractions.set(message.chat.id, {
    ...interaction,
    step: SALE_INPUT_STEPS.MARKETPLACE,
    salePriceKrw,
  });
  await sendMessage({
    chatId: message.chat.id,
    text: SALE_MARKETPLACE_PROMPT,
    replyMarkup: saleMarketplaceKeyboard(),
  });
  return { status: "awaiting_sale_marketplace" };
}

export async function handleSaleMarketplaceCallback({
  database,
  callbackQuery,
  pendingInteractions,
  sendMessage,
  editMessage,
  answerCallback,
  now = () => new Date(),
}) {
  const marketplace = parseSaleMarketplaceCallbackData(callbackQuery.data);
  const chatId = callbackQuery.message.chat.id;
  const interaction = pendingInteractions.get(chatId);
  if (!marketplace || interaction?.type !== "complete_sale"
    || interaction.step !== SALE_INPUT_STEPS.MARKETPLACE) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: NO_PENDING_SALE_MESSAGE,
    });
    return { status: "invalid_sale_marketplace" };
  }

  const saleListing = matchingSaleListing(
    database,
    interaction.inventoryItemId,
    marketplace.value,
  );
  let completed;
  try {
    completed = completeSale(database, {
      inventoryItemId: interaction.inventoryItemId,
      saleListingId: saleListing?.id ?? null,
      marketplace: marketplace.value,
      salePriceKrw: interaction.salePriceKrw,
      soldAt: now().toISOString(),
      note: null,
    });
  } catch (error) {
    if (!error.message.startsWith("Invalid inventory transition:")) {
      throw error;
    }
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: SALE_FAILED_MESSAGE,
    });
    return { status: "invalid_state" };
  }

  pendingInteractions.delete(chatId);
  const updated = renderUpdatedInventory(
    database,
    interaction.inventoryItemId,
    interaction.inventoryCode,
  );
  await editMessage({
    chatId,
    messageId: interaction.detailMessageId,
    ...updated,
  });
  await sendMessage({
    chatId,
    text: [
      "판매 완료했습니다.",
      `판매가: ${krwFormatter.format(interaction.salePriceKrw)}원`,
      `판매처: ${marketplace.label}`,
    ].join("\n"),
  });
  await answerCallback({ callbackQueryId: callbackQuery.id });

  return {
    status: "sale_completed",
    saleId: completed.sale.id,
    inventoryItemId: interaction.inventoryItemId,
  };
}
