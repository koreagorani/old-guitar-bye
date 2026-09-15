import { normalizeTelegramChatId } from "../telegram-access.js";

export function createPendingInteractionStore() {
  const interactions = new Map();

  return {
    get(chatId) {
      return interactions.get(normalizeTelegramChatId(chatId)) ?? null;
    },
    set(chatId, interaction) {
      interactions.set(normalizeTelegramChatId(chatId), interaction);
    },
    delete(chatId) {
      return interactions.delete(normalizeTelegramChatId(chatId));
    },
    has(chatId) {
      return interactions.has(normalizeTelegramChatId(chatId));
    },
  };
}
