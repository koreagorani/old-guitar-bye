const ALLOWED_TRANSITIONS = new Map([
  ["PENDING", new Set(["REVIEWING", "IGNORED"])],
  ["REVIEWING", new Set(["COMMITTED", "IGNORED"])],
  ["IGNORED", new Set()],
  ["COMMITTED", new Set(["PURCHASED", "CANCELLED"])],
  ["PURCHASED", new Set(["RECEIVED", "CANCELLED"])],
  ["RECEIVED", new Set()],
  ["CANCELLED", new Set()],
]);

function assertKnownAcquisitionState(state, argumentName) {
  if (!ALLOWED_TRANSITIONS.has(state)) {
    throw new TypeError(`Unknown acquisition state for ${argumentName}: ${String(state)}`);
  }
}

export function canTransitionAcquisition(currentState, nextState) {
  assertKnownAcquisitionState(currentState, "currentState");
  assertKnownAcquisitionState(nextState, "nextState");

  return ALLOWED_TRANSITIONS.get(currentState).has(nextState);
}

// RECEIVED means the guitar has physically arrived and an InventoryItem may
// be created. This pure state transition does not create an InventoryItem.
export function transitionAcquisition(currentState, nextState) {
  if (!canTransitionAcquisition(currentState, nextState)) {
    throw new Error(`Invalid acquisition transition: ${currentState} -> ${nextState}`);
  }

  return nextState;
}
