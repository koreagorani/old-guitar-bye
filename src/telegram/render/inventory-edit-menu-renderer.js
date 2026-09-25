const EDIT_ACTIONS = Object.freeze([
  Object.freeze({ id: "edit_purchase_price", label: "매입가 수정" }),
  Object.freeze({ id: "edit_expected_sale_price", label: "예상 판매가 수정" }),
]);

const BACK_ACTION = Object.freeze({ id: "back", label: "뒤로" });

export function renderInventoryEditMenu() {
  return {
    primaryActions: EDIT_ACTIONS.map((action) => ({ ...action })),
    secondaryActions: [{ ...BACK_ACTION }],
  };
}
