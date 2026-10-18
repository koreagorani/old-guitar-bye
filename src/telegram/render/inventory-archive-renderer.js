import { renderInventoryDetail } from "./inventory-detail-renderer.js";

function suffix(page) {
  return page === null ? "" : `:p${page}`;
}
export function renderArchivedInventoryDetail(detail, page = null) {
  const code = detail.inventory.inventoryCode;
  return {
    text: renderInventoryDetail(detail) + "\n\n🗃 제외된 재고입니다. 기존 기록은 모두 유지됩니다.",
    replyMarkup: {
      inline_keyboard: [
        [{ text:"재고 복원", callback_data:`inventory:restore_confirm:${code}${suffix(page)}` }],
        [{ text:"제외된 재고 목록", callback_data:`inventory:archived:${page ?? 0}` }],
      ],
    },
  };
}
