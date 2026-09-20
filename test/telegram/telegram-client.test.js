import assert from "node:assert/strict";
import test from "node:test";

import {
  answerTelegramCallbackQuery,
  editTelegramMessageText,
  getTelegramUpdates,
  setTelegramChatMenuButton,
  setTelegramCommands,
} from "../../src/telegram/telegram-client.js";

function fetchRecorder(result = true) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, result }),
      };
    },
  };
}

function failedFetch(description, status = 400) {
  return async () => ({
    ok: false,
    status,
    json: async () => ({ ok: false, description }),
  });
}

test("edits the existing Telegram message with refreshed buttons", async () => {
  const recorder = fetchRecorder({ message_id: 77 });
  const replyMarkup = {
    inline_keyboard: [[{
      text: "수리 완료",
      callback_data: "inventory:finish_repair:G-0003",
    }]],
  };

  await editTelegramMessageText({
    token: "test-token",
    chatId: 123,
    messageId: 77,
    text: "상태: 수리 중",
    replyMarkup,
    fetchImpl: recorder.fetchImpl,
  });

  assert.equal(
    recorder.requests[0].url,
    "https://api.telegram.org/bottest-token/editMessageText",
  );
  assert.deepEqual(JSON.parse(recorder.requests[0].options.body), {
    chat_id: 123,
    message_id: 77,
    text: "상태: 수리 중",
    reply_markup: replyMarkup,
  });
});

test("treats message is not modified as an idempotent edit", async () => {
  const result = await editTelegramMessageText({
    token: "test-token",
    chatId: 123,
    messageId: 77,
    text: "상태: 수리 중",
    fetchImpl: failedFetch("Bad Request: message is not modified"),
  });

  assert.deepEqual(result, { notModified: true });
});

test("does not hide other Telegram edit errors", async () => {
  await assert.rejects(
    editTelegramMessageText({
      token: "test-token",
      chatId: 123,
      messageId: 77,
      text: "상태: 수리 중",
      fetchImpl: failedFetch("Bad Request: message to edit not found"),
    }),
    /Telegram editMessageText failed: Bad Request: message to edit not found/,
  );
});

test("acknowledges a callback query with a Korean result message", async () => {
  const recorder = fetchRecorder(true);

  await answerTelegramCallbackQuery({
    token: "test-token",
    callbackQueryId: "callback-1",
    text: "수리 중으로 변경했습니다.",
    fetchImpl: recorder.fetchImpl,
  });

  assert.equal(
    recorder.requests[0].url,
    "https://api.telegram.org/bottest-token/answerCallbackQuery",
  );
  assert.deepEqual(JSON.parse(recorder.requests[0].options.body), {
    callback_query_id: "callback-1",
    text: "수리 중으로 변경했습니다.",
  });
});

test("polls both messages and callback queries", async () => {
  const recorder = fetchRecorder([]);

  await getTelegramUpdates({
    token: "test-token",
    offset: 5,
    fetchImpl: recorder.fetchImpl,
  });

  assert.deepEqual(JSON.parse(recorder.requests[0].options.body), {
    offset: 5,
    timeout: 30,
    allowed_updates: ["message", "callback_query"],
  });
});

test("sets the Telegram command menu", async () => {
  const recorder = fetchRecorder(true);
  const commands = [
    { command: "start", description: "봇 안내" },
    { command: "inventory", description: "현재 재고 목록 조회" },
    { command: "add", description: "새 기타 등록" },
    { command: "help", description: "사용 가능한 기능 안내" },
  ];

  await setTelegramCommands({
    token: "test-token",
    commands,
    fetchImpl: recorder.fetchImpl,
  });

  assert.equal(
    recorder.requests[0].url,
    "https://api.telegram.org/bottest-token/setMyCommands",
  );
  assert.deepEqual(JSON.parse(recorder.requests[0].options.body), { commands });
});

test("sets the Telegram chat menu button to commands", async () => {
  const recorder = fetchRecorder(true);

  await setTelegramChatMenuButton({
    token: "test-token",
    fetchImpl: recorder.fetchImpl,
  });

  assert.equal(
    recorder.requests[0].url,
    "https://api.telegram.org/bottest-token/setChatMenuButton",
  );
  assert.deepEqual(JSON.parse(recorder.requests[0].options.body), {
    menu_button: { type: "commands" },
  });
});
