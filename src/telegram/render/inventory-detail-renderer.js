import { inventoryStateLabel } from "./inventory-state-label.js";

const REPAIR_TYPE_LABELS = Object.freeze({
  CLEANING: "세척",
  STRING_CHANGE: "줄 교체",
  NECK_ADJUSTMENT: "넥 조정",
  ACTION_ADJUSTMENT: "액션 조정",
  FRET_WORK: "프렛 작업",
  ELECTRONICS: "전자계통",
  OTHER: "기타",
});

const EXPENSE_CATEGORY_LABELS = Object.freeze({
  LOGISTICS: "운송/이동비",
  PACKAGING: "포장비",
  MARKETPLACE_FEE: "판매 수수료",
  OTHER: "기타",
});

const MARKETPLACE_LABELS = Object.freeze({
  daangn: "당근",
  bunjang: "번개장터",
  direct: "직거래",
});

const krwFormatter = new Intl.NumberFormat("ko-KR");

function assertObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
}

function assertArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
}

function labelFor(labels, value, fieldName) {
  const label = labels[value];
  if (!label) {
    throw new TypeError(`Unknown ${fieldName}: ${value}`);
  }
  return label;
}

function formatKrw(value, fieldName) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${fieldName} must be a safe integer`);
  }
  return `${krwFormatter.format(value)}원`;
}

function marketplaceLabel(marketplace) {
  return MARKETPLACE_LABELS[marketplace] ?? marketplace;
}

function renderRepair(repair) {
  if (typeof repair.type !== "string" || repair.type.trim() === "") {
    throw new TypeError("repair.type must be a non-empty string");
  }
  const label = REPAIR_TYPE_LABELS[repair.type] ?? repair.type;
  const details = [];
  if (repair.costKrw > 0) {
    details.push(formatKrw(repair.costKrw, "repair.costKrw"));
  }
  if (repair.minutesSpent !== null && repair.minutesSpent > 0) {
    details.push(`${repair.minutesSpent}분`);
  }
  return `- ${label}${details.length > 0 ? ` ${details.join(" / ")}` : ""}`;
}

function renderExpense(expense) {
  const categoryLabel = labelFor(
    EXPENSE_CATEGORY_LABELS,
    expense.category,
    "expense category",
  );
  const label = typeof expense.note === "string"
    && expense.note.trim() !== ""
    ? expense.note
    : categoryLabel;
  return `- ${label} ${formatKrw(expense.amountKrw, "expense.amountKrw")}`;
}

function renderSaleListing(saleListing) {
  return `- ${marketplaceLabel(saleListing.marketplace)} ${formatKrw(
    saleListing.askingPriceKrw,
    "saleListing.askingPriceKrw",
  )}`;
}

function appendList(lines, title, items, renderer) {
  lines.push("", `${title}:`);
  if (items.length === 0) {
    lines.push("- 없음");
    return;
  }
  lines.push(...items.map(renderer));
}

export function renderInventoryDetail(detail) {
  assertObject(detail, "detail");
  assertObject(detail.inventory, "detail.inventory");
  assertObject(detail.acquisition, "detail.acquisition");
  assertObject(detail.cost, "detail.cost");
  assertArray(detail.repairs, "detail.repairs");
  assertArray(detail.expenses, "detail.expenses");
  assertArray(detail.saleListings, "detail.saleListings");

  const { inventory, cost, sale } = detail;
  const name = [inventory.inventoryCode, inventory.brand, inventory.modelName]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" ");
  const lines = [
    `🎸 ${name}`,
    `상태: ${inventoryStateLabel(inventory.state)}`,
    "",
    `매입가: ${formatKrw(cost.purchasePriceKrw, "cost.purchasePriceKrw")}`,
    `수리비: ${formatKrw(cost.repairCostTotalKrw, "cost.repairCostTotalKrw")}`,
    `기타비용: ${formatKrw(cost.expenseCostTotalKrw, "cost.expenseCostTotalKrw")}`,
    `총원가: ${formatKrw(cost.totalCostKrw, "cost.totalCostKrw")}`,
  ];

  if (inventory.expectedSalePriceKrw !== null) {
    lines.push(
      "",
      `예상 판매가: ${formatKrw(
        inventory.expectedSalePriceKrw,
        "inventory.expectedSalePriceKrw",
      )}`,
    );
  }
  if (cost.expectedProfitKrw !== null) {
    lines.push(
      `예상 이익: ${formatKrw(cost.expectedProfitKrw, "cost.expectedProfitKrw")}`,
    );
  }
  if (sale !== null) {
    assertObject(sale, "detail.sale");
    lines.push(
      "",
      `판매가: ${formatKrw(sale.salePriceKrw, "sale.salePriceKrw")}`,
    );
    if (cost.realizedProfitKrw !== null) {
      lines.push(
        `실현 이익: ${formatKrw(
          cost.realizedProfitKrw,
          "cost.realizedProfitKrw",
        )}`,
      );
    }
  }

  appendList(lines, "수리 기록", detail.repairs, renderRepair);
  appendList(lines, "비용 기록", detail.expenses, renderExpense);
  appendList(lines, "판매글", detail.saleListings, renderSaleListing);

  return lines.join("\n");
}
