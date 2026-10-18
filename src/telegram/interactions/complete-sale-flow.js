import { getInventoryDetail } from "../../application/inventory/get-inventory-detail.js";
import { completeSale } from "../../application/sales/complete-sale.js";
import { findInventoryItemById, updateInventoryState } from "../../repositories/inventory-repository.js";
import { listSaleListingsByInventoryItemId } from "../../repositories/sale-listing-repository.js";
import { renderInventoryActions } from "../render/inventory-action-renderer.js";
import { renderInventoryDetail } from "../render/inventory-detail-renderer.js";
import { buildInventoryInlineKeyboard } from "../render/telegram-keyboard.js";

export const SALE_PRICE_PROMPT = "실제 판매금액을 입력해주세요.\n예: 75000\n취소: /cancel";
export const INVALID_SALE_PRICE_MESSAGE = "판매가는 0 이상의 숫자로 입력해주세요.";
export const SALE_MARKETPLACE_PROMPT = "판매처를 선택해주세요.";
export const SALE_CANCELLED_MESSAGE = "판매 완료 입력을 취소했습니다.";
export const NO_PENDING_SALE_MESSAGE = "진행 중인 판매 입력이 없습니다.";
export const SALE_FAILED_MESSAGE = "현재 상태에서는 판매를 완료할 수 없습니다.";
export const SALE_INPUT_STEPS = Object.freeze({
  PRICE: "AWAITING_SALE_PRICE",
  MARKETPLACE: "AWAITING_SALE_MARKETPLACE",
  CONFIRM: "AWAITING_SALE_CONFIRM",
});
const MARKETPLACES = Object.freeze({
  daangn:"당근", bunjang:"번개장터", joonggonara:"중고나라",
  direct:"직거래", other:"기타",
});
const krw = (amount) => Number(amount).toLocaleString("ko-KR");
const suffix = (page) => page === null || page === undefined ? "" : `:p${page}`;

function activeListings(database,id) {
  return listSaleListingsByInventoryItemId(database,id).filter(x=>x.closedAt===null);
}
function inventoryCard(database,id,page=null) {
  const detail=getInventoryDetail(database,id);
  return {text:renderInventoryDetail(detail),
    replyMarkup:buildInventoryInlineKeyboard(renderInventoryActions(detail.inventory.state),
      detail.inventory.inventoryCode,{listPage:page})};
}
function backKeyboard(code,page) {
  return {inline_keyboard:[[{text:"취소",callback_data:`sale:cancel:${code}${suffix(page)}` }]]};
}
function marketplaceKeyboard(code,page) {
  const options=Object.entries(MARKETPLACES).map(([id,label])=>({
    text:label,callback_data:`sale:market:${id}:${code}${suffix(page)}`,
  }));
  return {inline_keyboard:[
    options.slice(0,2),options.slice(2,4),options.slice(4),
    [{text:"취소",callback_data:`sale:cancel:${code}${suffix(page)}`}],
  ]};
}
function summary(database,interaction) {
  const detail=getInventoryDetail(database,interaction.inventoryItemId);
  const cost=detail.cost, sale=interaction.salePriceKrw;
  return [
    "💰 판매 최종 확인","",
    `${detail.inventory.inventoryCode} · ${detail.inventory.brand} ${detail.inventory.modelName}`,
    `실제 판매금액: ${krw(sale)}원`,
    `판매처: ${MARKETPLACES[interaction.marketplace]}`,
    `매입원가: ${krw(cost.purchasePriceKrw)}원`,
    `수리비: ${krw(cost.repairCostTotalKrw)}원`,
    `기타비용: ${krw(cost.expenseCostTotalKrw)}원`,
    `누적 추가 비용: ${krw(cost.repairCostTotalKrw+cost.expenseCostTotalKrw)}원`,
    `총원가: ${krw(cost.totalCostKrw)}원`,
    `예상 실현손익: ${krw(sale-cost.totalCostKrw)}원`,
    "","⚠️ 미기록 수수료·배송비가 있다면 실제 이익은 달라집니다.",
    "⚠️ 판매 확정 시 모든 활성 판매글을 DB상 종료합니다.",
    "외부 플랫폼 게시글은 직접 판매 종료해주세요.",
  ].join("\n");
}
function codeMatch(data,action) {
  const expression=action==="market"
    ? /^sale:market:(daangn|bunjang|joonggonara|direct|other):(G-\d{4})(?::p(\d+))?$/
    : new RegExp(`^sale:${action}:(G-\\d{4})(?::p(\\d+))?$`);
  const match=expression.exec(data ?? "");
  if(!match)return null;
  const code=action==="market"?match[2]:match[1];
  const page=Number(action==="market"?match[3]??0:match[2]??0);
  if(!Number.isSafeInteger(page))return null;
  return {code,page,marketplace:action==="market"?match[1]:null};
}
export function parseSaleListingCallbackData(data) {
  if(typeof data!=="string")return null;
  const match=/^sale:listing:([1-9]\d*)$/.exec(data);
  return match && Number.isSafeInteger(Number(match[1]))?Number(match[1]):null;
}

export async function handleSaleMenu({database,inventory,callbackQuery,editMessage,answerCallback,page=null}) {
  const chatId=callbackQuery.message.chat.id,messageId=callbackQuery.message.message_id;
  let text,keyboard;
  if(inventory.state==="REPAIRING") {
    text="수리 중인 재고입니다. 수리 완료 후 판매 처리해주세요.";
    keyboard={inline_keyboard:[[{text:"뒤로",callback_data:`inventory:open:${inventory.inventoryCode}${suffix(page)}`}]]};
  } else if(inventory.state==="SOLD") {
    const detail=getInventoryDetail(database,inventory.id);
    text=renderInventoryDetail(detail)+"\n\n이미 판매 완료된 재고입니다.";
    keyboard={inline_keyboard:[[{text:"뒤로",callback_data:`inventory:open:${inventory.inventoryCode}${suffix(page)}`}]]};
  } else {
    text=`🎸 ${inventory.inventoryCode} ${inventory.brand} ${inventory.modelName}\n판매 처리 메뉴`;
    const actions=[];
    if(inventory.state==="IN_STOCK")actions.push([{text:"판매 중으로 변경",callback_data:`inventory:mark_for_sale:${inventory.inventoryCode}${suffix(page)}`}]);
    actions.push([{text:"판매 완료",callback_data:`inventory:complete_sale:${inventory.inventoryCode}${suffix(page)}`}]);
    actions.push([{text:"뒤로",callback_data:`inventory:open:${inventory.inventoryCode}${suffix(page)}`}]);
    keyboard={inline_keyboard:actions};
  }
  await editMessage({chatId,messageId,text,replyMarkup:keyboard});
  await answerCallback({callbackQueryId:callbackQuery.id});
  return {status:"sale_menu"};
}

export async function beginCompleteSaleFlow({inventory,callbackQuery,pendingInteractions,editMessage,answerCallback,page=null}) {
  if(!["IN_STOCK","FOR_SALE"].includes(inventory.state)) {
    await answerCallback({callbackQueryId:callbackQuery.id,text:SALE_FAILED_MESSAGE});
    return {status:"invalid_state",action:"complete_sale",inventoryCode:inventory.inventoryCode};
  }
  const chatId=callbackQuery.message.chat.id,messageId=callbackQuery.message.message_id;
  pendingInteractions.set(chatId,{
    type:"complete_sale",step:SALE_INPUT_STEPS.PRICE,inventoryItemId:inventory.id,
    inventoryCode:inventory.inventoryCode,mainMessageId:messageId,page,
  });
  await editMessage({chatId,messageId,text:SALE_PRICE_PROMPT,replyMarkup:backKeyboard(inventory.inventoryCode,page)});
  await answerCallback({callbackQueryId:callbackQuery.id});
  return {status:"awaiting_sale_price",inventoryItemId:inventory.id};
}

export async function handlePendingSaleMessage({database,message,pendingInteractions,editMessage,cleanupMessage}) {
  const chatId=message.chat.id,interaction=pendingInteractions.get(chatId);
  if(interaction?.type!=="complete_sale")return null;
  await cleanupMessage({chatId,messageId:message.message_id});
  const inventory=findInventoryItemById(database,interaction.inventoryItemId);
  if(!inventory||inventory.state==="SOLD"||inventory.archivedAt!==null) {
    pendingInteractions.delete(chatId);return {status:"invalid_state"};
  }
  if(message.text.trim()==="/cancel"){
    pendingInteractions.delete(chatId);
    await editMessage({chatId,messageId:interaction.mainMessageId,
      ...inventoryCard(database,inventory.id,interaction.page)});
    return {status:"cancelled"};
  }
  if(interaction.step===SALE_INPUT_STEPS.PRICE) {
    const input=message.text.trim(),price=/^\d+$/.test(input)?Number(input):NaN;
    if(!Number.isSafeInteger(price)) {
      await editMessage({chatId,messageId:interaction.mainMessageId,text:INVALID_SALE_PRICE_MESSAGE,
        replyMarkup:backKeyboard(inventory.inventoryCode,interaction.page)});
      return {status:"invalid_sale_price"};
    }
    pendingInteractions.set(chatId,{...interaction,step:SALE_INPUT_STEPS.MARKETPLACE,salePriceKrw:price});
    await editMessage({chatId,messageId:interaction.mainMessageId,text:SALE_MARKETPLACE_PROMPT,
      replyMarkup:marketplaceKeyboard(inventory.inventoryCode,interaction.page)});
    return {status:"awaiting_sale_marketplace"};
  }
  if(interaction.step===SALE_INPUT_STEPS.MARKETPLACE){
    await editMessage({chatId,messageId:interaction.mainMessageId,text:SALE_MARKETPLACE_PROMPT,
      replyMarkup:marketplaceKeyboard(inventory.inventoryCode,interaction.page)});
    return {status:"awaiting_sale_marketplace"};
  }
  await editMessage({chatId,messageId:interaction.mainMessageId,text:summary(database,interaction),
    replyMarkup:{inline_keyboard:[
      [{text:"판매 최종 확정",callback_data:`sale:confirm:${inventory.inventoryCode}${suffix(interaction.page)}`}],
      [{text:"취소",callback_data:`sale:cancel:${inventory.inventoryCode}${suffix(interaction.page)}`}],
    ]}});
  return {status:"awaiting_sale_confirmation"};
}

export async function handleSaleMarketplaceCallback({database,callbackQuery,pendingInteractions,editMessage,answerCallback}) {
  const parsed=codeMatch(callbackQuery.data,"market");
  const chatId=callbackQuery.message.chat.id,interaction=pendingInteractions.get(chatId);
  if(!parsed||interaction?.type!=="complete_sale"||
    interaction.step!==SALE_INPUT_STEPS.MARKETPLACE||
    interaction.inventoryCode!==parsed.code||
    interaction.mainMessageId!==callbackQuery.message.message_id) {
    await answerCallback({callbackQueryId:callbackQuery.id,text:NO_PENDING_SALE_MESSAGE});
    return {status:"invalid_sale_marketplace"};
  }
  const updated={...interaction,step:SALE_INPUT_STEPS.CONFIRM,marketplace:parsed.marketplace};
  pendingInteractions.set(chatId,updated);
  await editMessage({chatId,messageId:updated.mainMessageId,text:summary(database,updated),
    replyMarkup:{inline_keyboard:[
      [{text:"판매 최종 확정",callback_data:`sale:confirm:${parsed.code}${suffix(interaction.page)}`}],
      [{text:"취소",callback_data:`sale:cancel:${parsed.code}${suffix(interaction.page)}`}],
    ]}});
  await answerCallback({callbackQueryId:callbackQuery.id});
  return {status:"awaiting_sale_confirmation"};
}

export async function handleSaleConfirmationCallback({database,callbackQuery,pendingInteractions,editMessage,answerCallback,now=()=>new Date()}) {
  const action=callbackQuery.data?.startsWith("sale:confirm:")?"confirm":"cancel";
  const parsed=codeMatch(callbackQuery.data,action),chatId=callbackQuery.message.chat.id;
  const interaction=pendingInteractions.get(chatId);
  if(!parsed||interaction?.type!=="complete_sale"||
    interaction.inventoryCode!==parsed.code||
    interaction.mainMessageId!==callbackQuery.message.message_id||
    (action==="confirm"&&interaction.step!==SALE_INPUT_STEPS.CONFIRM)) {
    await answerCallback({callbackQueryId:callbackQuery.id,text:NO_PENDING_SALE_MESSAGE});
    return {status:"invalid_sale_confirmation"};
  }
  if(action==="cancel") {
    pendingInteractions.delete(chatId);
    await editMessage({chatId,messageId:interaction.mainMessageId,
      ...inventoryCard(database,interaction.inventoryItemId,interaction.page)});
    await answerCallback({callbackQueryId:callbackQuery.id});
    return {status:"cancelled"};
  }
  const inventory=findInventoryItemById(database,interaction.inventoryItemId);
  if(!inventory||inventory.archivedAt!==null||!["IN_STOCK","FOR_SALE"].includes(inventory.state)){
    pendingInteractions.delete(chatId);
    await answerCallback({callbackQueryId:callbackQuery.id,text:SALE_FAILED_MESSAGE});
    return {status:"invalid_state"};
  }
  const matching=activeListings(database,inventory.id)
    .filter((listing)=>listing.marketplace.toLowerCase()===interaction.marketplace)
    .sort((a,b)=>a.id-b.id);
  const saleListingId=matching[0]?.id??null;
  let result;
  try {
    result=completeSale(database,{
      inventoryItemId:inventory.id,saleListingId,
      marketplace:interaction.marketplace,salePriceKrw:interaction.salePriceKrw,
      soldAt:now().toISOString(),note:null,
    });
  } catch(error) {
    if(!/Invalid inventory transition:|UNIQUE constraint failed|Sale listing already closed/.test(error.message)) throw error;
    pendingInteractions.delete(chatId);
    await answerCallback({callbackQueryId:callbackQuery.id,text:SALE_FAILED_MESSAGE});
    return {status:"invalid_state"};
  }
  pendingInteractions.delete(chatId);
  const detail=inventoryCard(database,inventory.id,interaction.page);
  await editMessage({chatId,messageId:interaction.mainMessageId,
    ...detail,text:detail.text+"\n\n✅ 판매가 확정됐습니다. 외부 플랫폼 판매글은 직접 내려주세요."});
  await answerCallback({callbackQueryId:callbackQuery.id});
  return {status:"sale_completed",saleId:result.sale.id,inventoryItemId:inventory.id};
}
