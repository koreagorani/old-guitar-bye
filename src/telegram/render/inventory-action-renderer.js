const INVENTORY_STATES = new Set([
  "IN_STOCK",
  "REPAIRING",
  "FOR_SALE",
  "SOLD",
]);

const PRIMARY_ACTIONS = Object.freeze([
  Object.freeze({ id: "repair", label: "수리" }),
  Object.freeze({ id: "expense", label: "비용" }),
  Object.freeze({ id: "sale", label: "판매" }),
  Object.freeze({ id: "edit", label: "수정" }),
]);

const SECONDARY_ACTIONS = Object.freeze([
  Object.freeze({ id: "list", label: "목록으로" }),
]);

function copyActions(actions) {
  return actions.map((action) => ({ ...action }));
}

export function renderInventoryActions(inventoryState) {
  if (!INVENTORY_STATES.has(inventoryState)) {
    throw new TypeError(`Unknown inventory state: ${String(inventoryState)}`);
  }

  return {
    primaryActions: copyActions(PRIMARY_ACTIONS),
    secondaryActions: copyActions(SECONDARY_ACTIONS),
  };
}
