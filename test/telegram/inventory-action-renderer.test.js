import assert from "node:assert/strict";
import test from "node:test";

import { renderInventoryActions } from "../../src/telegram/render/inventory-action-renderer.js";

const inventoryStates = ["IN_STOCK", "REPAIRING", "FOR_SALE", "SOLD"];

const expectedPrimaryActions = [
  { id: "repair", label: "수리" },
  { id: "expense", label: "비용" },
  { id: "sale", label: "판매" },
  { id: "edit", label: "수정" },
];

const expectedSecondaryActions = [
  { id: "list", label: "목록으로" },
];

for (const state of inventoryStates) {
  test(`renders the top-level menu for ${state}`, () => {
    assert.deepEqual(renderInventoryActions(state), {
      primaryActions: expectedPrimaryActions,
      secondaryActions: expectedSecondaryActions,
    });
  });
}

test("uses Korean labels", () => {
  const { primaryActions, secondaryActions } = renderInventoryActions("IN_STOCK");

  for (const { label } of [...primaryActions, ...secondaryActions]) {
    assert.match(label, /[가-힣]/);
  }
});

test("uses English action ids", () => {
  const { primaryActions, secondaryActions } = renderInventoryActions("IN_STOCK");

  for (const { id } of [...primaryActions, ...secondaryActions]) {
    assert.match(id, /^[a-z]+(?:_[a-z]+)*$/);
  }
});

test("does not expose direct lifecycle actions in the top-level menu", () => {
  const { primaryActions, secondaryActions } = renderInventoryActions("IN_STOCK");
  const actionIds = [...primaryActions, ...secondaryActions].map(({ id }) => id);

  assert.deepEqual(actionIds, ["repair", "expense", "sale", "edit", "list"]);
  assert.ok(!actionIds.includes("start_repair"));
  assert.ok(!actionIds.includes("mark_for_sale"));
});

for (const unknownState of ["READY", "", null, undefined]) {
  test(`rejects unknown inventory state ${String(unknownState)}`, () => {
    assert.throws(
      () => renderInventoryActions(unknownState),
      new TypeError(`Unknown inventory state: ${String(unknownState)}`),
    );
  });
}

test("returns fresh action objects for each render", () => {
  const first = renderInventoryActions("IN_STOCK");
  const second = renderInventoryActions("IN_STOCK");

  first.primaryActions[0].label = "변경됨";
  first.secondaryActions[0].label = "변경됨";

  assert.equal(second.primaryActions[0].label, "수리");
  assert.equal(second.secondaryActions[0].label, "목록으로");
});
