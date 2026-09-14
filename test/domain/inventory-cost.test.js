import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateInventoryCost,
} from "../../src/domain/inventory/inventory-cost.js";

test("calculates cost with only a purchase price", () => {
  assert.deepEqual(calculateInventoryCost({ purchasePriceKrw: 20000 }), {
    purchasePriceKrw: 20000,
    repairCostTotalKrw: 0,
    expenseCostTotalKrw: 0,
    totalCostKrw: 20000,
    expectedProfitKrw: null,
    realizedProfitKrw: null,
  });
});

test("adds repair costs", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 20000,
    repairCostsKrw: [8000],
  });
  assert.equal(result.totalCostKrw, 28000);
});

test("adds expense costs", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 20000,
    expenseCostsKrw: [4000],
  });
  assert.equal(result.totalCostKrw, 24000);
});

test("adds repair and expense costs", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 20000,
    repairCostsKrw: [8000],
    expenseCostsKrw: [4000],
  });
  assert.equal(result.totalCostKrw, 32000);
});

test("sums multiple repair costs", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 20000,
    repairCostsKrw: [0, 8000, 2500],
  });
  assert.equal(result.repairCostTotalKrw, 10500);
});

test("sums multiple expense costs", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 20000,
    expenseCostsKrw: [3000, 1000, 5000],
  });
  assert.equal(result.expenseCostTotalKrw, 9000);
});

test("calculates expected profit", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 20000,
    repairCostsKrw: [8000],
    expenseCostsKrw: [4000],
    expectedSalePriceKrw: 80000,
  });
  assert.equal(result.expectedProfitKrw, 48000);
  assert.equal(result.realizedProfitKrw, null);
});

test("calculates realized profit", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 20000,
    repairCostsKrw: [8000],
    expenseCostsKrw: [4000],
    soldPriceKrw: 75000,
  });
  assert.equal(result.expectedProfitKrw, null);
  assert.equal(result.realizedProfitKrw, 43000);
});

test("allows zero values", () => {
  assert.deepEqual(calculateInventoryCost({
    purchasePriceKrw: 0,
    repairCostsKrw: [0],
    expenseCostsKrw: [0],
    expectedSalePriceKrw: 0,
    soldPriceKrw: 0,
  }), {
    purchasePriceKrw: 0,
    repairCostTotalKrw: 0,
    expenseCostTotalKrw: 0,
    totalCostKrw: 0,
    expectedProfitKrw: 0,
    realizedProfitKrw: 0,
  });
});

test("can return a negative profit", () => {
  const result = calculateInventoryCost({
    purchasePriceKrw: 50000,
    expectedSalePriceKrw: 40000,
    soldPriceKrw: 30000,
  });
  assert.equal(result.expectedProfitKrw, -10000);
  assert.equal(result.realizedProfitKrw, -20000);
});

const invalidValueCases = [
  {
    name: "negative purchase price",
    input: { purchasePriceKrw: -1 },
    error: /purchasePriceKrw must be a non-negative safe integer/,
  },
  {
    name: "negative repair cost",
    input: { purchasePriceKrw: 0, repairCostsKrw: [1000, -1] },
    error: /repairCostsKrw\[1\] must be a non-negative safe integer/,
  },
  {
    name: "negative expense cost",
    input: { purchasePriceKrw: 0, expenseCostsKrw: [-1] },
    error: /expenseCostsKrw\[0\] must be a non-negative safe integer/,
  },
  {
    name: "negative expected sale price",
    input: { purchasePriceKrw: 0, expectedSalePriceKrw: -1 },
    error: /expectedSalePriceKrw must be a non-negative safe integer/,
  },
  {
    name: "negative sold price",
    input: { purchasePriceKrw: 0, soldPriceKrw: -1 },
    error: /soldPriceKrw must be a non-negative safe integer/,
  },
];

for (const { name, input, error } of invalidValueCases) {
  test(`rejects a ${name}`, () => {
    assert.throws(() => calculateInventoryCost(input), error);
  });
}

test("rejects non-array cost collections", () => {
  assert.throws(
    () => calculateInventoryCost({
      purchasePriceKrw: 0,
      repairCostsKrw: 1000,
    }),
    /repairCostsKrw must be an array/,
  );
  assert.throws(
    () => calculateInventoryCost({
      purchasePriceKrw: 0,
      expenseCostsKrw: 1000,
    }),
    /expenseCostsKrw must be an array/,
  );
});

test("rejects totals outside the safe integer range", () => {
  assert.throws(
    () => calculateInventoryCost({
      purchasePriceKrw: Number.MAX_SAFE_INTEGER,
      repairCostsKrw: [1],
    }),
    /totalCostKrw exceeds the safe integer range/,
  );
});
