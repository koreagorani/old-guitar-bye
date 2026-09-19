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
    callback_data: action.id === "list"
      ? "inventory:list"
      : `inventory:${action.id}:${inventoryCode}`,
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
    const recordActions = actions.secondaryActions.filter(
      ({ id }) => id !== "list",
    );
    const navigationActions = actions.secondaryActions.filter(
      ({ id }) => id === "list",
    );
    if (recordActions.length > 0) {
      rows.push(recordActions.map((action) => toButton(
        action,
        inventoryCode,
      )));
    }
    rows.push(...navigationActions.map((action) => [toButton(
      action,
      inventoryCode,
    )]));
  }

  return { inline_keyboard: rows };
}
