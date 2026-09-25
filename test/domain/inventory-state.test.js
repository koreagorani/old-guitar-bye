import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionInventory,
  transitionInventory,
} from "../../src/domain/inventory/inventory-state.js";

const states = ["IN_STOCK", "REPAIRING", "FOR_SALE", "SOLD"];
const allowedTransitions = [
  ["IN_STOCK", "REPAIRING"],
  ["IN_STOCK", "FOR_SALE"],
  ["REPAIRING", "FOR_SALE"],
  ["FOR_SALE", "REPAIRING"],
  ["FOR_SALE", "SOLD"],
  ["SOLD", "FOR_SALE"],
];
const allowedTransitionKeys = new Set(
  allowedTransitions.map(([current, next]) => `${current}:${next}`),
);

for (const currentState of states) {
  for (const nextState of states) {
    const allowed = allowedTransitionKeys.has(`${currentState}:${nextState}`);
    test(`inventory ${allowed ? "allows" : "rejects"} ${currentState} -> ${nextState}`, () => {
      assert.equal(canTransitionInventory(currentState, nextState), allowed);
      if (allowed) {
        assert.equal(transitionInventory(currentState, nextState), nextState);
      } else {
        assert.throws(
          () => transitionInventory(currentState, nextState),
          new Error(`Invalid inventory transition: ${currentState} -> ${nextState}`),
        );
      }
    });
  }
}

const unknownStateCases = [
  ["UNKNOWN", "FOR_SALE", "currentState", "UNKNOWN"],
  ["IN_STOCK", "READY", "nextState", "READY"],
  [null, "FOR_SALE", "currentState", "null"],
];

for (const [currentState, nextState, argumentName, value] of unknownStateCases) {
  test(`inventory rejects unknown ${argumentName}: ${value}`, () => {
    const expectedError = new TypeError(
      `Unknown inventory state for ${argumentName}: ${value}`,
    );
    assert.throws(() => canTransitionInventory(currentState, nextState), expectedError);
    assert.throws(() => transitionInventory(currentState, nextState), expectedError);
  });
}
