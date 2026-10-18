import { listSalesPage, getSaleDetail } from "../../application/sales/query-sales.js";

export const EMPTY_SALES_MESSAGE = "판매 완료된 기타가 없습니다.";
export const SALES_PAGE_SIZE = 5;
const krw = value => `${Number(value).toLocaleString("ko-KR")}원`;
const MARKETPLACE_LABELS = {
  daangn: "당근", bunjang: "번개장터",
  joonggonara: "중고나라", direct: "직거래", other: "기타",
};
const label = marketplace => MARKETPLACE_LABELS[marketplace.toLowerCase()] ?? marketplace;
const saleCallback = (id, page) => `sales:open:${id}:${page}`;

export function renderSalesPage(result) {
  const { rows, total, page, pages } = result;
  const lines = rows.map(sale => [
    sale.inventoryCode, `${sale.brand} ${sale.modelName}`,
    `판매 ${krw(sale.salePriceKrw)}`,
    `손익 ${krw(sale.realizedProfitKrw)}`,
  ].join(" · "));
  const buttons = rows.map(sale => ({
    text: `${sale.inventoryCode} ${sale.brand} ${sale.modelName}`,
    callback_data: saleCallback(sale.saleId, page),
  }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  const navigation = [];
  if (page > 0) navigation.push({ text:"◀ 이전", callback_data:`sales:list:${page - 1}` });
  if (page + 1 < pages) navigation.push({ text:"다음 ▶", callback_data:`sales:list:${page + 1}` });
  if (navigation.length > 0) keyboard.push(navigation);

  return {
    text: total === 0 ? EMPTY_SALES_MESSAGE :
      ["💰 판매 완료 내역", `전체 ${total}건 · ${page + 1}/${pages} 페이지`, "", ...lines].join("\n"),
    replyMarkup: { inline_keyboard: keyboard },
  };
}

export function renderSaleDetail(detail, page) {
  const {sale, inventory, cost} = detail;
  const date = sale.soldAt.slice(0, 10);
  return {
    text: [
      "💰 판매 상세", "",
      `${inventory.inventoryCode} · ${inventory.brand} ${inventory.modelName}`,
      `판매 날짜: ${date}`,
      `판매처: ${label(sale.marketplace)}`,
      `실제 판매금액: ${krw(sale.salePriceKrw)}`,
      `매입원가: ${krw(cost.purchasePriceKrw)}`,
      `누적 수리비: ${krw(cost.repairCostTotalKrw)}`,
      `누적 기타 비용: ${krw(cost.expenseCostTotalKrw)}`,
      `총원가: ${krw(cost.totalCostKrw)}`,
      `실현손익: ${krw(sale.salePriceKrw - cost.totalCostKrw)}`,
    ].join("\n"),
    replyMarkup: { inline_keyboard: [[{
      text: "목록으로", callback_data: `sales:list:${page}`,
    }]] },
  };
}

export async function handleSalesCommand({database, chatId, sendMessage}) {
  const page = listSalesPage(database, {page:0,pageSize:SALES_PAGE_SIZE});
  await sendMessage({chatId, ...renderSalesPage(page)});
  return {status:page.total===0?"empty":"listed",count:page.total};
}

export async function handleSalesCallback({database, callbackQuery, editMessage, answerCallback}) {
  const data = callbackQuery.data ?? "";
  const list = /^sales:list:(0|[1-9]\d*)$/.exec(data);
  const open = /^sales:open:([1-9]\d*):(0|[1-9]\d*)$/.exec(data);
  const validPage = raw => Number.isSafeInteger(Number(raw));
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  if (list && validPage(list[1])) {
    const page = listSalesPage(database, {page:Number(list[1]),pageSize:SALES_PAGE_SIZE});
    await editMessage({chatId,messageId,...renderSalesPage(page)});
    await answerCallback({callbackQueryId:callbackQuery.id});
    return {status:"listed",count:page.total,page:page.page};
  }
  if (open && validPage(open[1]) && validPage(open[2])) {
    const detail = getSaleDetail(database, Number(open[1]));
    if (!detail) {
      const page = listSalesPage(database, {page:Number(open[2]),pageSize:SALES_PAGE_SIZE});
      await editMessage({chatId,messageId,...renderSalesPage(page)});
      await answerCallback({callbackQueryId:callbackQuery.id,text:"판매가 취소되었거나 더 이상 조회할 수 없습니다."});
      return {status:"not_found"};
    }
    const result = renderSaleDetail(detail,Number(open[2]));
    await editMessage({chatId,messageId,...result});
    await answerCallback({callbackQueryId:callbackQuery.id});
    return {status:"opened",saleId:detail.sale.saleId};
  }
  await answerCallback({callbackQueryId:callbackQuery.id,text:"올바르지 않은 판매 조회 요청입니다."});
  return {status:"invalid"};
}
