function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function toButton(action, inventoryCode) {
  assertNonEmptyString(action.id, "action.id");
  assertNonEmptyString(action.label, "action.label");

  return {
    text: action.label,
    callback_data: `inventory:${action.id}:${inventoryCode}`,
  };
}

export function buildInventoryInlineKeyboard(actions, inventoryCode) {
  if (actions === null || typeof actions !== "object" || Array.isArray(actions)) {
    throw new TypeError("actions must be an object");
  }
  if (!Array.isArray(actions.primaryActions)
    || !Array.isArray(actions.secondaryActions)) {
    throw new TypeError("actions must contain primaryActions and secondaryActions arrays");
  }
  assertNonEmptyString(inventoryCode, "inventoryCode");

  const rows = [];
  if (actions.primaryActions.length > 0) {
    rows.push(actions.primaryActions.map((action) => toButton(
      action,
      inventoryCode,
    )));
  }
  if (actions.secondaryActions.length > 0) {
    rows.push(actions.secondaryActions.map((action) => toButton(
      action,
      inventoryCode,
    )));
  }

  return { inline_keyboard: rows };
}
