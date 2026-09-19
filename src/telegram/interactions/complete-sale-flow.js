import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { completeSale } from "../../application/sales/complete-sale.js";
import {
  findSaleListingById,
  listSaleListingsByInventoryItemId,
} from "../../repositories/sale-listing-repository.js";
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

const MARKETPLACE_LABELS = Object.freeze({
  daangn: "당근",
  bunjang: "번개장터",
  joonggonara: "중고나라",
  direct: "직거래",
  other: "기타",
});

const krwFormatter = new Intl.NumberFormat("ko-KR");

function marketplaceLabel(marketplace) {
  return MARKETPLACE_LABELS[marketplace.toLowerCase()] ?? marketplace;
}

function saleListingKeyboard(saleListings) {
  const marketplaceCounts = new Map();
  for (const listing of saleListings) {
    const marketplace = listing.marketplace.toLowerCase();
    marketplaceCounts.set(marketplace, (marketplaceCounts.get(marketplace) ?? 0) + 1);
  }

  const buttons = saleListings.map((listing) => {
    const marketplace = listing.marketplace.toLowerCase();
    const label = marketplaceLabel(marketplace);
    return {
      text: marketplaceCounts.get(marketplace) > 1
        ? `${label} (${krwFormatter.format(listing.askingPriceKrw)}원)`
        : label,
      callback_data: `sale:listing:${listing.id}`,
    };
  });
  return {
    inline_keyboard: Array.from(
      { length: Math.ceil(buttons.length / 2) },
      (_, index) => buttons.slice(index * 2, index * 2 + 2),
    ),
  };
}

function parseSalePrice(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    return null;
  }
  const price = Number(text.trim());
  return Number.isSafeInteger(price) ? price : null;
}

export function parseSaleListingCallbackData(callbackData) {
  if (typeof callbackData !== "string") {
    return null;
  }
  const match = /^sale:listing:([1-9]\d*)$/.exec(callbackData);
  if (!match) {
    return null;
  }
  const saleListingId = Number(match[1]);
  return Number.isSafeInteger(saleListingId) ? saleListingId : null;
}

function activeSaleListings(database, inventoryItemId) {
  return listSaleListingsByInventoryItemId(database, inventoryItemId)
    .filter((listing) => listing.closedAt === null);
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

async function finishSale({
  database,
  interaction,
  saleListing,
  marketplace,
  marketplaceDisplay,
  pendingInteractions,
  chatId,
  sendMessage,
  editMessage,
  now,
  answerCallback,
  callbackQueryId,
}) {
  let completed;
  try {
    completed = completeSale(database, {
      inventoryItemId: interaction.inventoryItemId,
      saleListingId: saleListing?.id ?? null,
      marketplace,
      salePriceKrw: interaction.salePriceKrw,
      soldAt: now().toISOString(),
      note: null,
    });
  } catch (error) {
    if (!error.message.startsWith("Invalid inventory transition:")) {
      throw error;
    }
    if (answerCallback && callbackQueryId) {
      await answerCallback({ callbackQueryId, text: SALE_FAILED_MESSAGE });
    } else {
      await sendMessage({ chatId, text: SALE_FAILED_MESSAGE });
    }
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
      `판매처: ${marketplaceDisplay}`,
    ].join("\n"),
  });
  if (answerCallback && callbackQueryId) {
    await answerCallback({ callbackQueryId });
  }

  return {
    status: "sale_completed",
    saleId: completed.sale.id,
    inventoryItemId: interaction.inventoryItemId,
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
  database,
  message,
  pendingInteractions,
  sendMessage,
  editMessage,
  now = () => new Date(),
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
    const offeredListings = interaction.saleListingIds
      .map((id) => findSaleListingById(database, id))
      .filter((listing) => listing?.closedAt === null
        && listing.inventoryItemId === interaction.inventoryItemId);
    await sendMessage({
      chatId: message.chat.id,
      text: SALE_MARKETPLACE_PROMPT,
      replyMarkup: saleListingKeyboard(offeredListings),
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

  const pricedInteraction = {
    ...interaction,
    salePriceKrw,
  };
  const activeListings = activeSaleListings(database, interaction.inventoryItemId);

  if (activeListings.length === 0) {
    return finishSale({
      database,
      interaction: pricedInteraction,
      saleListing: null,
      marketplace: "direct",
      marketplaceDisplay: MARKETPLACE_LABELS.direct,
      pendingInteractions,
      chatId: message.chat.id,
      sendMessage,
      editMessage,
      now,
    });
  }

  if (activeListings.length === 1) {
    const [saleListing] = activeListings;
    return finishSale({
      database,
      interaction: pricedInteraction,
      saleListing,
      marketplace: saleListing.marketplace,
      marketplaceDisplay: marketplaceLabel(saleListing.marketplace),
      pendingInteractions,
      chatId: message.chat.id,
      sendMessage,
      editMessage,
      now,
    });
  }

  pendingInteractions.set(message.chat.id, {
    ...pricedInteraction,
    step: SALE_INPUT_STEPS.MARKETPLACE,
    saleListingIds: activeListings.map(({ id }) => id),
  });
  await sendMessage({
    chatId: message.chat.id,
    text: SALE_MARKETPLACE_PROMPT,
    replyMarkup: saleListingKeyboard(activeListings),
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
  const saleListingId = parseSaleListingCallbackData(callbackQuery.data);
  const chatId = callbackQuery.message.chat.id;
  const interaction = pendingInteractions.get(chatId);
  if (!saleListingId || interaction?.type !== "complete_sale"
    || interaction.step !== SALE_INPUT_STEPS.MARKETPLACE
    || !interaction.saleListingIds.includes(saleListingId)) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: NO_PENDING_SALE_MESSAGE,
    });
    return { status: "invalid_sale_marketplace" };
  }

  const saleListing = findSaleListingById(database, saleListingId);
  if (!saleListing || saleListing.closedAt !== null
    || saleListing.inventoryItemId !== interaction.inventoryItemId) {
    await answerCallback({
      callbackQueryId: callbackQuery.id,
      text: NO_PENDING_SALE_MESSAGE,
    });
    return { status: "invalid_sale_marketplace" };
  }

  return finishSale({
    database,
    interaction,
    saleListing,
    marketplace: saleListing.marketplace,
    marketplaceDisplay: marketplaceLabel(saleListing.marketplace),
    pendingInteractions,
    chatId,
    sendMessage,
    editMessage,
    now,
    answerCallback,
    callbackQueryId: callbackQuery.id,
  });
}
