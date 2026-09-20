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
    const description = payload.description ?? String(response.status);
    const error = new Error(`Telegram ${method} failed: ${description}`);
    error.telegramMethod = method;
    error.telegramDescription = description;
    throw error;
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

export async function editTelegramMessageText({
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
  try {
    return await callTelegramApi(token, "editMessageText", body, fetchImpl);
  } catch (error) {
    if (error.telegramMethod === "editMessageText"
      && /message is not modified/i.test(error.telegramDescription)) {
      return { notModified: true };
    }
    throw error;
  }
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

export function setTelegramCommands({
  token,
  commands,
  fetchImpl = globalThis.fetch,
}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new TypeError("commands must be a non-empty array");
  }
  for (const command of commands) {
    if (command === null || typeof command !== "object"
      || Array.isArray(command)) {
      throw new TypeError("each command must be an object");
    }
    assertNonEmptyString(command.command, "command.command");
    assertNonEmptyString(command.description, "command.description");
  }
  return callTelegramApi(token, "setMyCommands", { commands }, fetchImpl);
}
