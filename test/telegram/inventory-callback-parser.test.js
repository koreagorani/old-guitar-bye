import assert from "node:assert/strict";
import test from "node:test";

import { parseInventoryCallbackData } from "../../src/telegram/callbacks/inventory-callback-parser.js";
import { renderInventoryActions } from "../../src/telegram/render/inventory-action-renderer.js";
import { buildInventoryInlineKeyboard } from "../../src/telegram/render/telegram-keyboard.js";

const supportedActions = [
  "open",
  "repair",
  "expense",
  "sale",
  "edit",
  "edit_purchase_price",
  "edit_expected_sale_price",
  "cancel_sale",
  "back",
  "start_repair",
  "mark_for_sale",
  "finish_repair",
  "complete_sale",
  "add_repair_log",
  "add_expense",
];

test("parses the read-only inventory list callback", () => {
  assert.deepEqual(parseInventoryCallbackData("inventory:list"), {
    entity: "inventory",
    action: "list",
    inventoryCode: null,
  });
});

for (const action of supportedActions) {
  test(`parses the ${action} inventory callback`, () => {
    assert.deepEqual(
      parseInventoryCallbackData(`inventory:${action}:G-0003`),
      {
        entity: "inventory",
        action,
        inventoryCode: "G-0003",
      },
    );
  });
}

for (const state of ["IN_STOCK", "REPAIRING", "FOR_SALE", "SOLD"]) {
  test(`parses every keyboard callback rendered for ${state}`, () => {
    const actions = renderInventoryActions(state);
    const buttons = buildInventoryInlineKeyboard(actions, "G-0042")
      .inline_keyboard
      .flat();

    for (const button of buttons) {
      const parsed = parseInventoryCallbackData(button.callback_data);
      assert.equal(parsed.entity, "inventory");
      if (parsed.action === "list") {
        assert.equal(parsed.inventoryCode, null);
      } else {
        assert.equal(parsed.inventoryCode, "G-0042");
      }
      assert.equal(parsed.action, button.callback_data.split(":")[1]);
    }
  });
}

const malformedCallbacks = [
  "",
  "acquisition:start_repair:G-0003",
  "inventory:start_repair",
  "inventory:start_repair:G-0003:extra",
  "inventory:START_REPAIR:G-0003",
  "inventory:start-repair:G-0003",
  "inventory:start_repair:g-0003",
  "inventory:start_repair:G-003",
  "inventory:start_repair:G-00003",
];

for (const callbackData of malformedCallbacks) {
  test(`rejects malformed callback data: ${callbackData || "<empty>"}`, () => {
    assert.throws(
      () => parseInventoryCallbackData(callbackData),
      new TypeError("Invalid inventory callback data"),
    );
  });
}

test("rejects an unsupported inventory action", () => {
  assert.throws(
    () => parseInventoryCallbackData("inventory:delete_inventory:G-0003"),
    new Error("Unsupported inventory action: delete_inventory"),
  );
});

test("rejects the removed view_detail action", () => {
  assert.throws(
    () => parseInventoryCallbackData("inventory:view_detail:G-0003"),
    new Error("Unsupported inventory action: view_detail"),
  );
});

for (const callbackData of [null, undefined, 123, {}]) {
  test(`rejects non-string callback data: ${String(callbackData)}`, () => {
    assert.throws(
      () => parseInventoryCallbackData(callbackData),
      new TypeError("callbackData must be a string"),
    );
  });
}
