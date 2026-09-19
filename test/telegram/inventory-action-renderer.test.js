import assert from "node:assert/strict";
import test from "node:test";

import { renderInventoryActions } from "../../src/telegram/render/inventory-action-renderer.js";

const expectedPrimaryActions = {
  IN_STOCK: [
    { id: "start_repair", label: "수리 시작" },
    { id: "mark_for_sale", label: "바로 판매" },
  ],
  REPAIRING: [
    { id: "finish_repair", label: "수리 완료" },
  ],
  FOR_SALE: [
    { id: "complete_sale", label: "판매 완료" },
  ],
  SOLD: [],
};

for (const [state, primaryActions] of Object.entries(expectedPrimaryActions)) {
  test(`renders primary actions for ${state}`, () => {
    assert.deepEqual(
      renderInventoryActions(state).primaryActions,
      primaryActions,
    );
  });
}

test("renders no primary action for SOLD inventory", () => {
  assert.deepEqual(renderInventoryActions("SOLD").primaryActions, []);
});

test("uses Korean labels for every visible action", () => {
  for (const state of Object.keys(expectedPrimaryActions)) {
    const { primaryActions, secondaryActions } = renderInventoryActions(state);
    for (const { label } of [...primaryActions, ...secondaryActions]) {
      assert.match(label, /[가-힣]/);
      assert.doesNotMatch(label, /_/);
    }
  }
});

test("uses English action ids", () => {
  for (const state of Object.keys(expectedPrimaryActions)) {
    const { primaryActions, secondaryActions } = renderInventoryActions(state);
    for (const { id } of [...primaryActions, ...secondaryActions]) {
      assert.match(id, /^[a-z]+(?:_[a-z]+)*$/);
      assert.doesNotMatch(id, /[가-힣]/);
    }
  }
});

const expectedSecondaryActions = [
  { id: "add_repair_log", label: "수리 기록 추가" },
  { id: "add_expense", label: "비용 추가" },
];

for (const action of expectedSecondaryActions) {
  test(`includes the common ${action.id} action`, () => {
    for (const state of Object.keys(expectedPrimaryActions)) {
      assert.deepEqual(
        renderInventoryActions(state).secondaryActions,
        expectedSecondaryActions,
      );
    }
  });
}

test("keeps correction actions available after sale", () => {
  assert.deepEqual(
    renderInventoryActions("SOLD").secondaryActions,
    expectedSecondaryActions,
  );
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

  assert.equal(second.primaryActions[0].label, "수리 시작");
  assert.equal(second.secondaryActions[0].label, "수리 기록 추가");
});
