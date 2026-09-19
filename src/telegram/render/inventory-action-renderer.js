const PRIMARY_ACTIONS_BY_STATE = Object.freeze({
  IN_STOCK: Object.freeze([
    Object.freeze({ id: "start_repair", label: "수리 시작" }),
    Object.freeze({ id: "mark_for_sale", label: "바로 판매" }),
  ]),
  REPAIRING: Object.freeze([
    Object.freeze({ id: "finish_repair", label: "수리 완료" }),
  ]),
  FOR_SALE: Object.freeze([
    Object.freeze({ id: "complete_sale", label: "판매 완료" }),
  ]),
  SOLD: Object.freeze([]),
});

const SECONDARY_ACTIONS = Object.freeze([
  Object.freeze({ id: "add_repair_log", label: "수리 기록 추가" }),
  Object.freeze({ id: "add_expense", label: "비용 추가" }),
]);

function copyActions(actions) {
  return actions.map((action) => ({ ...action }));
}

export function renderInventoryActions(inventoryState) {
  if (!Object.hasOwn(PRIMARY_ACTIONS_BY_STATE, inventoryState)) {
    throw new TypeError(`Unknown inventory state: ${String(inventoryState)}`);
  }

  return {
    primaryActions: copyActions(PRIMARY_ACTIONS_BY_STATE[inventoryState]),
    secondaryActions: copyActions(SECONDARY_ACTIONS),
  };
}
