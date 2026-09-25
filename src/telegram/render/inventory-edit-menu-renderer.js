const INVENTORY_STATES = new Set([
  "IN_STOCK",
  "REPAIRING",
  "FOR_SALE",
  "SOLD",
]);

const EDIT_ACTIONS = Object.freeze([
  Object.freeze({ id: "edit_purchase_price", label: "매입가 수정" }),
  Object.freeze({ id: "edit_expected_sale_price", label: "예상 판매가 수정" }),
]);

const CANCEL_SALE_ACTION = Object.freeze({
  id: "cancel_sale",
  label: "판매 취소",
});

const BACK_ACTION = Object.freeze({ id: "back", label: "뒤로" });

export function renderInventoryEditMenu(
  inventoryState,
  { hasRepairLogs = false, hasExpenses = false } = {},
) {
  if (!INVENTORY_STATES.has(inventoryState)) {
    throw new TypeError(`Unknown inventory state: ${String(inventoryState)}`);
  }

  const primaryActions = EDIT_ACTIONS.map((action) => ({ ...action }));
  if (hasRepairLogs) {
    primaryActions.push({ id: "edit_repair_log", label: "수리 기록 수정" });
  }
  if (hasExpenses) {
    primaryActions.push({ id: "edit_expense_record", label: "비용 기록 수정" });
  }
  if (inventoryState === "SOLD") {
    primaryActions.push({ ...CANCEL_SALE_ACTION });
  }

  return {
    primaryActions,
    secondaryActions: [{ ...BACK_ACTION }],
  };
}
