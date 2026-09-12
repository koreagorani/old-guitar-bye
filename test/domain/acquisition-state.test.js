import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionAcquisition,
  transitionAcquisition,
} from "../../src/domain/acquisition/acquisition-state.js";

const states = ["FOUND", "BUYING", "RECEIVED", "IGNORED", "CANCELLED"];
const allowedTransitions = [
  ["FOUND", "BUYING"],
  ["FOUND", "IGNORED"],
  ["BUYING", "RECEIVED"],
  ["BUYING", "CANCELLED"],
];
const allowedTransitionKeys = new Set(
  allowedTransitions.map(([current, next]) => `${current}:${next}`),
);

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

const unknownStateCases = [
  ["UNKNOWN", "BUYING", "currentState", "UNKNOWN"],
  ["FOUND", "PENDING", "nextState", "PENDING"],
  [null, "BUYING", "currentState", "null"],
];

for (const [currentState, nextState, argumentName, value] of unknownStateCases) {
  test(`acquisition rejects unknown ${argumentName}: ${value}`, () => {
    const expectedError = new TypeError(
      `Unknown acquisition state for ${argumentName}: ${value}`,
    );
    assert.throws(() => canTransitionAcquisition(currentState, nextState), expectedError);
    assert.throws(() => transitionAcquisition(currentState, nextState), expectedError);
  });
}

test("RECEIVED marks physical arrival when InventoryItem creation becomes possible", () => {
  assert.equal(transitionAcquisition("BUYING", "RECEIVED"), "RECEIVED");
});
