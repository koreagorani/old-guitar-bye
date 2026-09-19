const INVENTORY_STATE_LABELS = Object.freeze({
  IN_STOCK: "재고 보유",
  REPAIRING: "수리 중",
  FOR_SALE: "판매 가능",
  SOLD: "판매 완료",
});

export function inventoryStateLabel(state) {
  const label = INVENTORY_STATE_LABELS[state];
  if (!label) {
    throw new TypeError(`Unknown inventory state: ${state}`);
  }
  return label;
}
