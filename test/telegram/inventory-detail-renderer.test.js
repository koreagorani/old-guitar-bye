import assert from "node:assert/strict";
import test from "node:test";

import { renderInventoryDetail } from "../../src/telegram/render/inventory-detail-renderer.js";

function detailFixture(overrides = {}) {
  const detail = {
    inventory: {
      id: 3,
      inventoryCode: "G-0003",
      acquisitionId: 2,
      brand: "Yamaha",
      modelName: "F310",
      guitarType: "ACOUSTIC",
      serialNumber: null,
      state: "FOR_SALE",
      storageLocation: null,
      purchasePriceKrw: 20000,
      receivedAt: "2026-09-03T00:00:00Z",
      expectedSalePriceKrw: 80000,
      note: "internal inventory note",
      createdAt: "2026-09-03 00:00:00",
      updatedAt: "2026-09-03 00:00:00",
    },
    acquisition: {
      id: 2,
      listingId: 1,
      status: "RECEIVED",
      agreedPurchasePriceKrw: 20000,
      boughtAt: "2026-09-02T00:00:00Z",
      receivedAt: "2026-09-03T00:00:00Z",
      note: "internal acquisition note",
    },
    repairs: [],
    expenses: [],
    saleListings: [],
    sale: null,
    cost: {
      purchasePriceKrw: 20000,
      repairCostTotalKrw: 0,
      expenseCostTotalKrw: 0,
      totalCostKrw: 20000,
      expectedProfitKrw: 60000,
      realizedProfitKrw: null,
    },
  };

  return {
    ...detail,
    ...overrides,
    inventory: { ...detail.inventory, ...overrides.inventory },
    acquisition: { ...detail.acquisition, ...overrides.acquisition },
    cost: { ...detail.cost, ...overrides.cost },
  };
}

for (const [state, label] of [
  ["IN_STOCK", "재고 보유"],
  ["REPAIRING", "수리 중"],
  ["FOR_SALE", "판매 가능"],
  ["SOLD", "판매 완료"],
]) {
  test(`renders ${state} as ${label}`, () => {
    const text = renderInventoryDetail(detailFixture({
      inventory: { state },
    }));
    assert.match(text, new RegExp(`상태: ${label}`));
    assert.doesNotMatch(text, new RegExp(state));
  });
}

for (const [status, label] of [
  ["FOUND", "매물 발견"],
  ["BUYING", "구매 진행"],
  ["RECEIVED", "입고 완료"],
  ["IGNORED", "무시"],
  ["CANCELLED", "거래 취소"],
]) {
  test(`renders acquisition ${status} as ${label}`, () => {
    const text = renderInventoryDetail(detailFixture({
      acquisition: { status },
    }));
    assert.match(text, new RegExp(`매입 상태: ${label}`));
    assert.doesNotMatch(text, new RegExp(status));
  });
}

test("formats Korean won with thousands separators", () => {
  const text = renderInventoryDetail(detailFixture());
  assert.match(text, /매입가: 20,000원/);
  assert.match(text, /수리비: 0원/);
  assert.match(text, /예상 판매가: 80,000원/);
});

test("renders repair records with Korean labels", () => {
  const text = renderInventoryDetail(detailFixture({
    repairs: [
      {
        id: 1,
        inventoryItemId: 3,
        type: "CLEANING",
        costKrw: 0,
        minutesSpent: null,
        note: null,
        performedAt: "2026-09-04T00:00:00Z",
      },
      {
        id: 2,
        inventoryItemId: 3,
        type: "STRING_CHANGE",
        costKrw: 8000,
        minutesSpent: 10,
        note: null,
        performedAt: "2026-09-05T00:00:00Z",
      },
    ],
  }));

  assert.match(text, /수리 기록:\n- 세척\n- 줄 교체 8,000원 \/ 10분/);
});

test("renders expense records with Korean labels", () => {
  const text = renderInventoryDetail(detailFixture({
    expenses: [
      {
        id: 1,
        inventoryItemId: 3,
        category: "LOGISTICS",
        amountKrw: 3000,
        note: null,
        occurredAt: "2026-09-03T00:00:00Z",
      },
      {
        id: 2,
        inventoryItemId: 3,
        category: "MARKETPLACE_FEE",
        amountKrw: 1000,
        note: null,
        occurredAt: "2026-09-06T00:00:00Z",
      },
    ],
  }));

  assert.match(text, /비용 기록:\n- 운송\/이동비 3,000원\n- 판매 수수료 1,000원/);
});

test("renders sale listings with friendly marketplace names", () => {
  const text = renderInventoryDetail(detailFixture({
    saleListings: [
      {
        id: 1,
        inventoryItemId: 3,
        marketplace: "daangn",
        askingPriceKrw: 80000,
        listedAt: "2026-09-07T00:00:00Z",
        closedAt: null,
        url: null,
        externalListingId: null,
      },
      {
        id: 2,
        inventoryItemId: 3,
        marketplace: "bunjang",
        askingPriceKrw: 79000,
        listedAt: "2026-09-08T00:00:00Z",
        closedAt: null,
        url: null,
        externalListingId: null,
      },
    ],
  }));

  assert.match(text, /판매글:\n- 당근 80,000원\n- 번개장터 79,000원/);
});

test("omits actual sale values when no sale exists", () => {
  const text = renderInventoryDetail(detailFixture());
  assert.doesNotMatch(text, /^판매가:/m);
  assert.doesNotMatch(text, /^실현 이익:/m);
});

test("renders actual sale values when a sale exists", () => {
  const text = renderInventoryDetail(detailFixture({
    inventory: { state: "SOLD" },
    sale: {
      id: 1,
      inventoryItemId: 3,
      saleListingId: null,
      marketplace: "direct",
      salePriceKrw: 75000,
      soldAt: "2026-09-10T00:00:00Z",
      note: null,
    },
    cost: { realizedProfitKrw: 55000 },
  }));

  assert.match(text, /판매가: 75,000원/);
  assert.match(text, /실현 이익: 55,000원/);
});

test("renders expected profit", () => {
  const text = renderInventoryDetail(detailFixture());
  assert.match(text, /예상 이익: 60,000원/);
});

test("renders realized profit", () => {
  const text = renderInventoryDetail(detailFixture({
    sale: {
      inventoryItemId: 3,
      salePriceKrw: 75000,
      soldAt: "2026-09-10T00:00:00Z",
      marketplace: "direct",
    },
    cost: { realizedProfitKrw: 55000 },
  }));
  assert.match(text, /실현 이익: 55,000원/);
});

test("renders empty record collections as none", () => {
  const text = renderInventoryDetail(detailFixture());
  assert.match(text, /수리 기록:\n- 없음/);
  assert.match(text, /비용 기록:\n- 없음/);
  assert.match(text, /판매글:\n- 없음/);
});

test("omits optional expected values when they are null", () => {
  const text = renderInventoryDetail(detailFixture({
    inventory: {
      serialNumber: null,
      storageLocation: null,
      expectedSalePriceKrw: null,
      note: null,
    },
    cost: {
      expectedProfitKrw: null,
      realizedProfitKrw: null,
    },
  }));

  assert.doesNotMatch(text, /예상 판매가:/);
  assert.doesNotMatch(text, /예상 이익:/);
  assert.doesNotMatch(text, /null/);
});

test("does not expose internal ids, notes, or urls", () => {
  const text = renderInventoryDetail(detailFixture());
  assert.doesNotMatch(text, /internal inventory note/);
  assert.doesNotMatch(text, /internal acquisition note/);
  assert.doesNotMatch(text, /acquisitionId|listingId|inventoryItemId/);
});

test("does not mutate the query result", () => {
  const detail = detailFixture();
  const before = structuredClone(detail);
  renderInventoryDetail(detail);
  assert.deepEqual(detail, before);
});
