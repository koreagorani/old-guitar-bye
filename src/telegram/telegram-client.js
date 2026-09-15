function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

async function callTelegramApi(token, method, body, fetchImpl) {
  assertNonEmptyString(token, "token");
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  const response = await fetchImpl(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      `Telegram ${method} failed: ${payload.description ?? response.status}`,
    );
  }
  return payload.result;
}

export function sendTelegramMessage({
  token,
  chatId,
  text,
  replyMarkup = null,
  fetchImpl = globalThis.fetch,
}) {
  assertNonEmptyString(text, "text");
  const body = { chat_id: chatId, text };
  if (replyMarkup !== null) {
    body.reply_markup = replyMarkup;
  }
  return callTelegramApi(token, "sendMessage", body, fetchImpl);
}

export function editTelegramMessageText({
  token,
  chatId,
  messageId,
  text,
  replyMarkup = null,
  fetchImpl = globalThis.fetch,
}) {
  assertNonEmptyString(text, "text");
  const body = { chat_id: chatId, message_id: messageId, text };
  if (replyMarkup !== null) {
    body.reply_markup = replyMarkup;
  }
  return callTelegramApi(token, "editMessageText", body, fetchImpl);
}

export function answerTelegramCallbackQuery({
  token,
  callbackQueryId,
  text = null,
  fetchImpl = globalThis.fetch,
}) {
  assertNonEmptyString(callbackQueryId, "callbackQueryId");
  const body = { callback_query_id: callbackQueryId };
  if (text !== null) {
    assertNonEmptyString(text, "text");
    body.text = text;
  }
  return callTelegramApi(token, "answerCallbackQuery", body, fetchImpl);
}

export function getTelegramUpdates({
  token,
  offset = 0,
  timeout = 30,
  fetchImpl = globalThis.fetch,
}) {
  return callTelegramApi(
    token,
    "getUpdates",
    { offset, timeout, allowed_updates: ["message", "callback_query"] },
    fetchImpl,
  );
}
