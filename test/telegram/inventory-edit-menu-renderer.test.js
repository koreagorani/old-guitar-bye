import assert from "node:assert/strict";
import test from "node:test";

import { renderInventoryEditMenu } from "../../src/telegram/render/inventory-edit-menu-renderer.js";

test("hides record edit actions when there are no records", () => {
  const actions = renderInventoryEditMenu("IN_STOCK");
  assert.deepEqual(
    actions.primaryActions.map(({ id }) => id),
    ["edit_purchase_price", "edit_expected_sale_price"],
  );
});

test("shows repair and expense edit actions only when matching records exist", () => {
  const repairOnly = renderInventoryEditMenu("IN_STOCK", { hasRepairLogs: true });
  assert.ok(repairOnly.primaryActions.some(({ id }) => id === "edit_repair_log"));
  assert.ok(!repairOnly.primaryActions.some(({ id }) => id === "edit_expense_record"));

  const both = renderInventoryEditMenu("IN_STOCK", {
    hasRepairLogs: true,
    hasExpenses: true,
  });
  assert.ok(both.primaryActions.some(({ id }) => id === "edit_repair_log"));
  assert.ok(both.primaryActions.some(({ id }) => id === "edit_expense_record"));
});
