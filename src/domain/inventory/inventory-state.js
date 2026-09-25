const ALLOWED_TRANSITIONS = new Map([
  ["IN_STOCK", new Set(["REPAIRING", "FOR_SALE"])],
  ["REPAIRING", new Set(["FOR_SALE"])],
  ["FOR_SALE", new Set(["REPAIRING", "SOLD"])],
  ["SOLD", new Set(["FOR_SALE"])],
]);

function assertKnownInventoryState(state, argumentName) {
  if (!ALLOWED_TRANSITIONS.has(state)) {
    throw new TypeError(`Unknown inventory state for ${argumentName}: ${String(state)}`);
  }
}

export function canTransitionInventory(currentState, nextState) {
  assertKnownInventoryState(currentState, "currentState");
  assertKnownInventoryState(nextState, "nextState");

  return ALLOWED_TRANSITIONS.get(currentState).has(nextState);
}

export function transitionInventory(currentState, nextState) {
  if (!canTransitionInventory(currentState, nextState)) {
    throw new Error(`Invalid inventory transition: ${currentState} -> ${nextState}`);
  }

  return nextState;
}
