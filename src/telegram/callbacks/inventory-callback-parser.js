const INVENTORY_ACTIONS = new Set([
  "open",
  "repair",
  "expense",
  "sale",
  "edit",
  "start_repair",
  "mark_for_sale",
  "finish_repair",
  "complete_sale",
  "add_repair_log",
  "add_expense",
]);

const INVENTORY_CALLBACK_PATTERN = /^inventory:([a-z]+(?:_[a-z]+)*):(G-\d{4})$/;

export function parseInventoryCallbackData(callbackData) {
  if (typeof callbackData !== "string") {
    throw new TypeError("callbackData must be a string");
  }

  if (callbackData === "inventory:list") {
    return {
      entity: "inventory",
      action: "list",
      inventoryCode: null,
    };
  }

  const match = INVENTORY_CALLBACK_PATTERN.exec(callbackData);
  if (match === null) {
    throw new TypeError("Invalid inventory callback data");
  }

  const [, action, inventoryCode] = match;
  if (!INVENTORY_ACTIONS.has(action)) {
    throw new Error(`Unsupported inventory action: ${action}`);
  }

  return {
    entity: "inventory",
    action,
    inventoryCode,
  };
}
