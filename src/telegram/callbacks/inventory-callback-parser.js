const INVENTORY_ACTIONS = new Set([
  "open",
  "open_archived",
  "archive_confirm",
  "archive_do",
  "archive_cancel",
  "restore_confirm",
  "restore_do",
  "restore_cancel",
  "repair",
  "expense",
  "sale",
  "edit",
  "edit_purchase_price",
  "edit_expected_sale_price",
  "edit_repair_log",
  "edit_expense_record",
  "cancel_sale",
  "back",
  "start_repair",
  "mark_for_sale",
  "finish_repair",
  "complete_sale",
  "add_repair_log",
  "add_expense",
]);

const INVENTORY_CALLBACK_PATTERN = /^inventory:([a-z]+(?:_[a-z]+)*):(G-\d{4})(?::p(0|[1-9]\d*))?$/;

export function parseInventoryCallbackData(callbackData) {
  if (typeof callbackData !== "string") {
    throw new TypeError("callbackData must be a string");
  }

  const list = /^inventory:(list|archived)(?::(0|[1-9]\d*))?$/.exec(callbackData);
  if (list) {
    return {
      entity: "inventory",
      action: list[1],
      inventoryCode: null,
      ...(list[2] === undefined ? {} : { page: Number(list[2]) }),
    };
  }

  const match = INVENTORY_CALLBACK_PATTERN.exec(callbackData);
  if (match === null) {
    throw new TypeError("Invalid inventory callback data");
  }

  const [, action, inventoryCode, rawPage] = match;
  if (!INVENTORY_ACTIONS.has(action)) {
    throw new Error(`Unsupported inventory action: ${action}`);
  }

  return {
    entity: "inventory",
    action,
    inventoryCode,
    ...(rawPage === undefined ? {} : { page: Number(rawPage) }),
  };
}
