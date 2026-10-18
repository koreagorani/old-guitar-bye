import { inventoryStateLabel } from "./inventory-state-label.js";

export const EMPTY_INVENTORY_MESSAGE = "현재 보유 중인 재고가 없습니다.";
export const INVENTORY_PAGE_SIZE = 5;

function displayName(inventory) {
  return `${inventory.brand} ${inventory.modelName}`;
}

export function renderInventoryList(inventoryItems, { page = 0, archived = false } = {}) {
  if (!Array.isArray(inventoryItems)) throw new TypeError("inventoryItems must be an array");
  if (!Number.isSafeInteger(page) || page < 0) throw new TypeError("Invalid inventory page");
  const total = inventoryItems.length;
  const pages = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const items = inventoryItems.slice(current * INVENTORY_PAGE_SIZE,
    (current + 1) * INVENTORY_PAGE_SIZE);
  const title = archived ? "🗃 제외된 재고" : "🎸 현재 재고";
  const lines = items.map((item) =>
    `${item.inventoryCode} · ${displayName(item)} · ${inventoryStateLabel(item.state)}`
  );
  const buttons = items.map((item) => ({
    text: `${item.inventoryCode} ${displayName(item)}`,
    callback_data: `inventory:${archived ? "open_archived" : "open"}:${item.inventoryCode}:p${current}`,
  }));
  const inlineKeyboard = [];
  for (let i = 0; i < buttons.length; i += 2) {
    inlineKeyboard.push(buttons.slice(i, i + 2));
  }
  const kind = archived ? "archived" : "list";
  const navigation = [];
  if (current > 0) {
    navigation.push({ text: "◀ 이전", callback_data: `inventory:${kind}:${current - 1}` });
  }
  if (current + 1 < pages) {
    navigation.push({ text: "다음 ▶", callback_data: `inventory:${kind}:${current + 1}` });
  }
  if (navigation.length > 0) inlineKeyboard.push(navigation);
  inlineKeyboard.push([archived ?
    { text: "현재 재고", callback_data: "inventory:list:0" } :
    { text: "제외된 재고", callback_data: "inventory:archived:0" }]);

  return {
    text: total === 0
      ? (archived ? "제외된 재고가 없습니다." : EMPTY_INVENTORY_MESSAGE)
      : [title, `전체 ${total}건 · ${current + 1}/${pages} 페이지`, "", ...lines].join("\n"),
    replyMarkup: { inline_keyboard: inlineKeyboard },
  };
}
