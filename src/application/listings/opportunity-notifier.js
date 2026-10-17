import {
  findOpportunityNotification,
  saveOpportunityNotification,
} from "../../repositories/opportunity-notification-repository.js";
import { normalizeTelegramChatId } from "../../telegram/telegram-access.js";
import { OPPORTUNITY_DECISION } from "./evaluate-bunjang-opportunities.js";

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function formatKrw(value) {
  return Number(value).toLocaleString("ko-KR");
}

export function loadOpportunityTelegramConfig(env = process.env) {
  assertNonEmptyString(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN");
  if (
    env.TELEGRAM_ALLOWED_CHAT_ID === undefined
    || env.TELEGRAM_ALLOWED_CHAT_ID === null
    || String(env.TELEGRAM_ALLOWED_CHAT_ID).trim() === ""
  ) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID is required");
  }

  return {
    token: env.TELEGRAM_BOT_TOKEN.trim(),
    chatId: normalizeTelegramChatId(
      env.TELEGRAM_ALLOWED_CHAT_ID,
      "TELEGRAM_ALLOWED_CHAT_ID",
    ),
  };
}

export function formatOpportunityTelegramMessage(opportunity) {
  if (
    opportunity === null
    || typeof opportunity !== "object"
    || Array.isArray(opportunity)
  ) {
    throw new TypeError("opportunity must be an object");
  }

  const identity = [
    opportunity.brand,
    opportunity.model,
    opportunity.variant ? `[${opportunity.variant}]` : null,
  ].filter(Boolean).join(" ");

  return [
    "🎸 매입 후보 발견",
    "",
    identity || opportunity.title,
    `중고가: ${formatKrw(opportunity.askingPriceKrw)}원`,
    `신품가: ${formatKrw(opportunity.referenceNewPriceKrw)}원`,
    `신품 대비: ${opportunity.ratioPct.toFixed(2)}%`,
    "",
    "제목:",
    opportunity.title,
    "",
    "번개장터:",
    opportunity.url,
  ].join("\n");
}

function notificationRecord(opportunity, notifiedAt) {
  return {
    marketplace: opportunity.marketplace ?? "BUNJANG",
    externalListingId: opportunity.externalListingId,
    notifiedAt,
    askingPriceKrw: opportunity.askingPriceKrw,
    referenceNewPriceKrw: opportunity.referenceNewPriceKrw,
    ratioPct: opportunity.ratioPct,
  };
}

export async function notifyTrackOpportunities({
  database,
  opportunities,
  chatId,
  sendMessage,
  now = () => new Date(),
}) {
  if (!database) throw new TypeError("database is required");
  if (!Array.isArray(opportunities)) {
    throw new TypeError("opportunities must be an array");
  }
  if (typeof sendMessage !== "function") {
    throw new TypeError("sendMessage must be a function");
  }
  const normalizedChatId = normalizeTelegramChatId(chatId, "chatId");

  const summary = {
    sent: 0,
    duplicate: 0,
    failed: 0,
    failures: [],
  };

  for (const opportunity of opportunities) {
    if (opportunity?.decision !== OPPORTUNITY_DECISION.TRACK) {
      continue;
    }

    const marketplace = opportunity.marketplace ?? "BUNJANG";
    const existing = findOpportunityNotification(
      database,
      marketplace,
      opportunity.externalListingId,
    );
    if (existing) {
      summary.duplicate += 1;
      continue;
    }

    try {
      await sendMessage({
        chatId: normalizedChatId,
        text: formatOpportunityTelegramMessage(opportunity),
      });
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        marketplace,
        externalListingId: opportunity.externalListingId,
        stage: "SEND",
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
      });
      continue;
    }

    try {
      const date = now();
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new TypeError("now() must return a valid Date");
      }
      saveOpportunityNotification(
        database,
        notificationRecord(opportunity, date.toISOString()),
      );
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        marketplace,
        externalListingId: opportunity.externalListingId,
        stage: "RECORD",
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
      });
    }
  }

  return summary;
}
