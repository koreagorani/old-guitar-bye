import { listActiveCandidates, findCandidateById, dismissCandidate } from "../../repositories/opportunity-candidate-repository.js";
import { acquireCandidate } from "../../application/listings/acquire-candidate.js";
import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

const money = (n) => Number(n).toLocaleString("ko-KR");
const pageIndex = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const validId = (value) => Number.isSafeInteger(value) && value > 0;
function card(candidate) {
  return [
    "🎸 매입 후보",
    "",
    `${candidate.brand} ${candidate.model}${candidate.variant ? " ["+candidate.variant+"]" : ""}`,
    `중고가: ${money(candidate.askingPriceKrw)}원`,
    `신품가: ${money(candidate.referenceNewPriceKrw)}원`,
    `신품 대비: ${candidate.ratioPct.toFixed(2)}%`,
    "", candidate.title, candidate.url,
  ].join("\n");
}
function buttons(candidate, page) {
  return { inline_keyboard: [
    [{ text: "매입 확정", callback_data: `cand:buy:${candidate.id}:${page}` },
     { text: "후보 제외", callback_data: `cand:exclude:${candidate.id}:${page}` }],
    [{ text: "번개장터 보기", url: candidate.url }],
    [{ text: "목록", callback_data: `cand:list:${page}` }],
  ] };
}
export function renderCandidatePage(database, page = 0) {
  const requested = pageIndex(page);
  const data = listActiveCandidates(database, { page: requested });
  const actual = Math.min(requested, data.pages - 1);
  const view = actual === requested ? data : listActiveCandidates(database, { page: actual });
  const navigation = [];
  if (actual > 0) navigation.push({ text: "◀ 이전", callback_data: `cand:list:${actual - 1}` });
  if (actual + 1 < view.pages) navigation.push({ text: "다음 ▶", callback_data: `cand:list:${actual + 1}` });
  return {
    text: view.total === 0 ? "진행 중인 매입 후보가 없습니다." :
      ["🎸 매입 후보", `${view.total}건 · ${actual + 1}/${view.pages} 페이지`, "",
       ...view.rows.map((c, i) => `${actual * view.pageSize + i + 1}. ${c.brand} ${c.model} · ${c.ratioPct.toFixed(2)}% · ${money(c.askingPriceKrw)}원`)].join("\n"),
    replyMarkup: { inline_keyboard: [
      ...view.rows.map((c) => [{ text: `${c.brand} ${c.model} (${c.ratioPct.toFixed(2)}%)`, callback_data: `cand:open:${c.id}:${actual}` }]),
      ...(navigation.length ? [navigation] : []),
    ] },
  };
}
export async function handleCandidatesCommand({ database, chatId, sendMessage }) {
  await sendMessage({ chatId, ...renderCandidatePage(database) });
  return { status: "candidates_listed" };
}
export async function handleCandidateCallback({ database, callbackQuery, pendingInteractions, editMessage, answerCallback }) {
  const chatId = callbackQuery.message.chat.id, messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data ?? "";
  const list = /^cand:list:(\d+)$/.exec(data);
  if (list) {
    await editMessage({ chatId, messageId, ...renderCandidatePage(database, Number(list[1])) });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "candidates_listed" };
  }
  const match = /^cand:(open|buy|exclude|confirm|cancel):(\d+):(\d+)$/.exec(data);
  if (!match) {
    await answerCallback({ callbackQueryId: callbackQuery.id, text: "유효하지 않은 후보 작업입니다." });
    return { status: "invalid" };
  }
  const [, action, rawId, rawPage] = match;
  const id = Number(rawId), page = Number(rawPage);
  if (!validId(id) || !Number.isSafeInteger(page)) return { status: "invalid" };
  const candidate = findCandidateById(database, id);
  if (!candidate || candidate.status !== "ACTIVE") {
    pendingInteractions.delete(chatId);
    await editMessage({ chatId, messageId, text: "이미 처리되었거나 없는 후보입니다.", replyMarkup: { inline_keyboard: [[{ text:"목록", callback_data:`cand:list:${page}` }]] } });
    await answerCallback({ callbackQueryId: callbackQuery.id });
    return { status: "not_active" };
  }
  if (action === "exclude") {
    dismissCandidate(database, id);
    pendingInteractions.delete(chatId);
    await editMessage({ chatId, messageId, ...renderCandidatePage(database, page) });
  } else if (action === "buy") {
    pendingInteractions.set(chatId, { type:"candidate_purchase", candidateId:id, page, step:"price", mainMessageId:messageId });
    await editMessage({ chatId, messageId, text: card(candidate) + "\n\n실제 지불한 매입가(원)를 입력해주세요.\n취소: /cancel", replyMarkup:{ inline_keyboard:[[{text:"취소",callback_data:`cand:cancel:${id}:${page}`}]] } });
  } else if (action === "cancel") {
    pendingInteractions.delete(chatId);
    await editMessage({ chatId, messageId, text:card(candidate), replyMarkup:buttons(candidate,page) });
  } else if (action === "confirm") {
    const pending = pendingInteractions.get(chatId);
    if (pending?.type !== "candidate_purchase" || pending.step !== "confirm" || pending.candidateId !== id || pending.mainMessageId !== messageId) {
      await answerCallback({ callbackQueryId:callbackQuery.id, text:"매입가 입력 후 최종 확인해주세요." });
      return { status:"invalid_confirmation" };
    }
    const result = acquireCandidate(database, { candidateId:id, purchasePriceKrw:pending.purchasePriceKrw });
    pendingInteractions.delete(chatId);
    if (result.status !== "acquired") {
      await editMessage({ chatId, messageId, text:"이미 매입되었거나 처리된 후보입니다.", replyMarkup:{inline_keyboard:[]} });
    } else {
      const detail = getInventoryDetail(database, result.inventory.id);
      await editMessage({ chatId, messageId, text: renderInventoryDetail(detail),
        replyMarkup: buildInventoryInlineKeyboard(renderInventoryActions(detail.inventory.state), result.inventory.inventoryCode) });
    }
  } else {
    await editMessage({ chatId, messageId, text:card(candidate), replyMarkup:buttons(candidate,page) });
  }
  await answerCallback({ callbackQueryId: callbackQuery.id });
  return { status:action };
}
export async function handlePendingCandidatePurchase({ database, message, pendingInteractions, editMessage, cleanupMessage }) {
  const chatId = message.chat.id;
  const pending = pendingInteractions.get(chatId);
  if (pending?.type !== "candidate_purchase") return null;
  await cleanupMessage({ chatId, messageId: message.message_id });
  const candidate = findCandidateById(database, pending.candidateId);
  if (!candidate || candidate.status !== "ACTIVE") {
    pendingInteractions.delete(chatId);
    return { status:"not_active" };
  }
  if (message.text.trim() === "/cancel") {
    pendingInteractions.delete(chatId);
    await editMessage({ chatId, messageId:pending.mainMessageId, text:card(candidate), replyMarkup:buttons(candidate,pending.page) });
    return { status:"cancelled" };
  }
  if (pending.step !== "price") return { status:"awaiting_confirmation" };
  const value = message.text.trim();
  const price = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(price)) {
    await editMessage({ chatId, messageId:pending.mainMessageId,
      text:card(candidate)+"\n\n매입가는 0 이상의 정수를 입력해주세요.", replyMarkup:{inline_keyboard:[[{text:"취소",callback_data:`cand:cancel:${candidate.id}:${pending.page}`}]]} });
    return { status:"invalid_price" };
  }
  pendingInteractions.set(chatId, { ...pending, step:"confirm", purchasePriceKrw:price });
  await editMessage({ chatId, messageId:pending.mainMessageId,
    text:card(candidate)+`\n\n실제 매입가: ${money(price)}원\n실물 입고를 확인했다면 최종 확정해주세요.`,
    replyMarkup:{ inline_keyboard:[
      [{text:"입고 및 매입 최종 확정", callback_data:`cand:confirm:${candidate.id}:${pending.page}`}],
      [{text:"취소",callback_data:`cand:cancel:${candidate.id}:${pending.page}`}],
    ] },
  });
  return { status:"awaiting_confirmation" };
}
