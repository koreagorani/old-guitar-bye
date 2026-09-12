import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionAcquisition,
  transitionAcquisition,
} from "../../src/domain/acquisition/acquisition-state.js";

const states = [
  "PENDING", "REVIEWING", "IGNORED", "COMMITTED",
  "PURCHASED", "RECEIVED", "CANCELLED",
];

const allowedTransitions = [
  ["PENDING", "REVIEWING"],
  ["PENDING", "IGNORED"],
  ["REVIEWING", "COMMITTED"],
  ["REVIEWING", "IGNORED"],
  ["COMMITTED", "PURCHASED"],
  ["COMMITTED", "CANCELLED"],
  ["PURCHASED", "RECEIVED"],
  ["PURCHASED", "CANCELLED"],
];

const allowedTransitionKeys = new Set(
  allowedTransitions.map(([current, next]) => `${current}:${next}`),
);

// All 7 x 7 pairs include self-transitions and every terminal-state exit.
for (const currentState of states) {
  for (const nextState of states) {
    const allowed = allowedTransitionKeys.has(`${currentState}:${nextState}`);
    test(`acquisition ${allowed ? "allows" : "rejects"} ${currentState} -> ${nextState}`, () => {
      assert.equal(canTransitionAcquisition(currentState, nextState), allowed);
      if (allowed) {
        assert.equal(transitionAcquisition(currentState, nextState), nextState);
      } else {
        assert.throws(
          () => transitionAcquisition(currentState, nextState),
          new Error(`Invalid acquisition transition: ${currentState} -> ${nextState}`),
        );
      }
    });
  }
}

const unknownStates = [
  "UNKNOWN", "pending", "", "SOLD", null, undefined, 0, false, {}, [],
];

for (const [index, value] of unknownStates.entries()) {
  for (const argumentName of ["currentState", "nextState"]) {
    test(`acquisition rejects unknown ${argumentName} case ${index + 1}`, () => {
      const args = argumentName === "currentState"
        ? [value, "REVIEWING"]
        : ["PENDING", value];
      const expectedError = new TypeError(
        `Unknown acquisition state for ${argumentName}: ${String(value)}`,
      );
      assert.throws(() => canTransitionAcquisition(...args), expectedError);
      assert.throws(() => transitionAcquisition(...args), expectedError);
    });
  }
}

test("RECEIVED marks physical arrival when InventoryItem creation becomes possible", () => {
  assert.equal(transitionAcquisition("PURCHASED", "RECEIVED"), "RECEIVED");
});
