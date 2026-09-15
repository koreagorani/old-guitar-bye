export function normalizeTelegramChatId(chatId, fieldName = "chatId") {
  if (typeof chatId === "number") {
    if (!Number.isSafeInteger(chatId)) {
      throw new TypeError(`${fieldName} must be a safe integer or integer string`);
    }
    return String(chatId);
  }

  if (typeof chatId === "string" && /^-?\d+$/.test(chatId.trim())) {
    return BigInt(chatId.trim()).toString();
  }

  throw new TypeError(`${fieldName} must be a safe integer or integer string`);
}

export function isAllowedTelegramChat(chatId, allowedChatId) {
  try {
    return normalizeTelegramChatId(chatId)
      === normalizeTelegramChatId(allowedChatId, "allowedChatId");
  } catch {
    return false;
  }
}
