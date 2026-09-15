import assert from "node:assert/strict";
import test from "node:test";

import {
  handleTelegramUpdate,
  runBot,
  START_MESSAGE,
} from "../../src/telegram/bot.js";
import {
  isAllowedTelegramChat,
  normalizeTelegramChatId,
} from "../../src/telegram/telegram-access.js";

function recorder() {
  const messages = [];
  return {
    messages,
    sendMessage: async (message) => messages.push(message),
  };
}

test("allows /start from the configured chat", async () => {
  const sent = recorder();
  const result = await handleTelegramUpdate(
    { message: { chat: { id: 123 }, text: "/start" } },
    {
      database: null,
      sendMessage: sent.sendMessage,
      allowedChatId: "123",
    },
  );

  assert.deepEqual(result, { status: "started" });
  assert.deepEqual(sent.messages, [{ chatId: 123, text: START_MESSAGE }]);
});

test("allows /inventory from the configured chat", async () => {
  let prepareCalls = 0;
  const database = {
    prepare() {
      prepareCalls += 1;
      return { get: () => null };
    },
  };
  const sent = recorder();
  const result = await handleTelegramUpdate(
    { message: { chat: { id: "123" }, text: "/inventory G-9999" } },
    { database, sendMessage: sent.sendMessage, allowedChatId: 123 },
  );

  assert.deepEqual(result, { status: "not_found", inventoryCode: "G-9999" });
  assert.equal(prepareCalls, 1);
});

for (const command of ["/start", "/inventory G-0001"]) {
  test(`silently ignores unauthorized ${command.split(" ")[0]}`, async () => {
    const sent = recorder();
    const result = await handleTelegramUpdate(
      { message: { chat: { id: 999 }, text: command } },
      {
        database: null,
        sendMessage: sent.sendMessage,
        allowedChatId: "123",
      },
    );

    assert.deepEqual(result, { status: "ignored" });
    assert.deepEqual(sent.messages, []);
  });
}

test("does not access the database for an unauthorized inventory command", async () => {
  const database = new Proxy({}, {
    get() {
      throw new Error("database must not be accessed");
    },
  });
  const sent = recorder();

  const result = await handleTelegramUpdate(
    { message: { chat: { id: 999 }, text: "/inventory G-0001" } },
    {
      database,
      sendMessage: sent.sendMessage,
      allowedChatId: "123",
    },
  );

  assert.deepEqual(result, { status: "ignored" });
  assert.deepEqual(sent.messages, []);
});

test("compares number and string chat ids consistently", () => {
  assert.equal(isAllowedTelegramChat(123, "123"), true);
  assert.equal(isAllowedTelegramChat("123", 123), true);
  assert.equal(isAllowedTelegramChat(-100123, "-100123"), true);
  assert.equal(isAllowedTelegramChat("00123", 123), true);
  assert.equal(normalizeTelegramChatId("00123"), "123");
});

test("rejects different or malformed chat ids", () => {
  assert.equal(isAllowedTelegramChat(999, "123"), false);
  assert.equal(isAllowedTelegramChat("not-a-chat", "123"), false);
  assert.equal(isAllowedTelegramChat(123, undefined), false);
});

test("requires TELEGRAM_ALLOWED_CHAT_ID before opening the database", async () => {
  await assert.rejects(
    runBot({
      token: "test-token",
      databasePath: "/path/that/must/not/be/opened.sqlite",
      allowedChatId: "",
    }),
    new Error("TELEGRAM_ALLOWED_CHAT_ID is required"),
  );
});

test("rejects a malformed TELEGRAM_ALLOWED_CHAT_ID", async () => {
  await assert.rejects(
    runBot({
      token: "test-token",
      databasePath: "/path/that/must/not/be/opened.sqlite",
      allowedChatId: "not-a-chat-id",
    }),
    /TELEGRAM_ALLOWED_CHAT_ID must be a safe integer or integer string/,
  );
});
