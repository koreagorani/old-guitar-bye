import { inventoryStateLabel } from "./inventory-state-label.js";

export const EMPTY_INVENTORY_MESSAGE = "현재 보유 중인 재고가 없습니다.";

function assertInventoryItems(inventoryItems) {
  if (!Array.isArray(inventoryItems) || inventoryItems.length === 0) {
    throw new TypeError("inventoryItems must be a non-empty array");
  }
}

function displayName(inventory) {
  return `${inventory.brand} ${inventory.modelName}`;
}

export function renderInventoryList(inventoryItems) {
  assertInventoryItems(inventoryItems);

  const itemLines = inventoryItems.map((inventory) => (
    `${inventory.inventoryCode} · ${displayName(inventory)} · ${inventoryStateLabel(inventory.state)}`
  ));
  const inlineKeyboard = inventoryItems.map((inventory) => [{
    text: `${inventory.inventoryCode} ${displayName(inventory)}`,
    callback_data: `inventory:open:${inventory.inventoryCode}`,
  }]);

  return {
    text: ["🎸 현재 재고", "", ...itemLines].join("\n"),
    replyMarkup: { inline_keyboard: inlineKeyboard },
  };
}
