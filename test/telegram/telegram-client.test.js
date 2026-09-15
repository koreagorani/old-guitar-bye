import assert from "node:assert/strict";
import test from "node:test";

import {
  answerTelegramCallbackQuery,
  editTelegramMessageText,
  getTelegramUpdates,
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
