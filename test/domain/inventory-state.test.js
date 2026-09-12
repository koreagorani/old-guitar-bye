import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionInventory,
  transitionInventory,
} from "../../src/domain/inventory/inventory-state.js";

const states = [
  "RECEIVED",
  "INSPECTING",
  "REPAIRING",
  "READY",
  "LISTED",
  "SOLD",
];

const allowedTransitions = [
  ["RECEIVED", "INSPECTING"],
  ["INSPECTING", "REPAIRING"],
  ["INSPECTING", "READY"],
  ["REPAIRING", "READY"],
  ["READY", "REPAIRING"],
  ["READY", "LISTED"],
  ["LISTED", "READY"],
  ["LISTED", "SOLD"],
];

const allowedTransitionKeys = new Set(
  allowedTransitions.map(([currentState, nextState]) => `${currentState}:${nextState}`),
);

const forbiddenTransitions = states.flatMap((currentState) =>
  states
    .filter(
      (nextState) => !allowedTransitionKeys.has(`${currentState}:${nextState}`),
    )
    .map((nextState) => [currentState, nextState]),
);

for (const [currentState, nextState] of allowedTransitions) {
  test(`allows ${currentState} -> ${nextState}`, () => {
    assert.equal(canTransitionInventory(currentState, nextState), true);
    assert.equal(transitionInventory(currentState, nextState), nextState);
  });
}

for (const [currentState, nextState] of forbiddenTransitions) {
  test(`rejects ${currentState} -> ${nextState}`, () => {
    assert.equal(canTransitionInventory(currentState, nextState), false);
    assert.throws(
      () => transitionInventory(currentState, nextState),
      new Error(`Invalid inventory transition: ${currentState} -> ${nextState}`),
    );
  });
}

const unknownStateCases = [
  ["UNKNOWN", "READY", "currentState", "UNKNOWN"],
  ["READY", "UNKNOWN", "nextState", "UNKNOWN"],
  [null, "READY", "currentState", "null"],
];

for (const [currentState, nextState, argumentName, value] of unknownStateCases) {
  test(`rejects unknown ${argumentName}: ${value}`, () => {
    const expectedError = new TypeError(
      `Unknown inventory state for ${argumentName}: ${value}`,
    );

    assert.throws(
      () => canTransitionInventory(currentState, nextState),
      expectedError,
    );
    assert.throws(
      () => transitionInventory(currentState, nextState),
      expectedError,
    );
  });
}
