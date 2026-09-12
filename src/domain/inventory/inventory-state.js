const INVENTORY_STATES = new Set([
  "RECEIVED",
  "INSPECTING",
  "REPAIRING",
  "READY",
  "LISTED",
  "SOLD",
]);

const ALLOWED_TRANSITIONS = new Map([
  ["RECEIVED", new Set(["INSPECTING"])],
  ["INSPECTING", new Set(["REPAIRING", "READY"])],
  ["REPAIRING", new Set(["READY"])],
  ["READY", new Set(["REPAIRING", "LISTED"])],
  ["LISTED", new Set(["READY", "SOLD"])],
  ["SOLD", new Set()],
]);

function assertKnownInventoryState(state, argumentName) {
  if (!INVENTORY_STATES.has(state)) {
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
