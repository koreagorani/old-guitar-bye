import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import {
  findInventoryItemByCode,
  listActiveInventoryItems,
} from "../../repositories/inventory-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { renderInventoryList } from "../render/inventory-list-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const INVENTORY_USAGE_MESSAGE = "사용법: /inventory G-0003";
export const INVENTORY_NOT_FOUND_MESSAGE = "해당 재고를 찾을 수 없습니다.";
export const EMPTY_INVENTORY_MESSAGE = "현재 보유 중인 재고가 없습니다.";

function isInventoryListCommand(commandText) {
  return typeof commandText === "string"
    && /^\/inventory(?:@[A-Za-z0-9_]+)?$/.test(commandText.trim());
}

export function parseInventoryCommand(commandText) {
  if (typeof commandText !== "string") {
    return null;
  }
  const match = commandText.trim().match(
    /^\/inventory(?:@[A-Za-z0-9_]+)?\s+(\S+)$/,
  );
  return match?.[1] ?? null;
}

export async function handleInventoryCommand({
  database,
  chatId,
  commandText,
  sendMessage,
}) {
  if (isInventoryListCommand(commandText)) {
    const inventoryItems = listActiveInventoryItems(database);
    if (inventoryItems.length === 0) {
      await sendMessage({ chatId, text: EMPTY_INVENTORY_MESSAGE });
      return { status: "empty" };
    }

    const rendered = renderInventoryList(inventoryItems);
    await sendMessage({ chatId, ...rendered });
    return { status: "listed", count: inventoryItems.length };
  }

  const inventoryCode = parseInventoryCommand(commandText);
  if (inventoryCode === null) {
    await sendMessage({ chatId, text: INVENTORY_USAGE_MESSAGE });
    return { status: "invalid" };
  }

  const inventory = findInventoryItemByCode(database, inventoryCode);
  if (!inventory) {
    await sendMessage({ chatId, text: INVENTORY_NOT_FOUND_MESSAGE });
    return { status: "not_found", inventoryCode };
  }

  const detail = getInventoryDetail(database, inventory.id);
  const text = renderInventoryDetail(detail);
  const actions = renderInventoryActions(detail.inventory.state);
  const replyMarkup = buildInventoryInlineKeyboard(actions, inventoryCode);

  await sendMessage({ chatId, text, replyMarkup });
  return { status: "found", inventoryItemId: inventory.id };
}
