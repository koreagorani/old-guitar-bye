function assertNonNegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
}

function assertNullableNonNegativeInteger(value, fieldName) {
  if (value !== null) {
    assertNonNegativeInteger(value, fieldName);
  }
}

function sumCosts(costs, fieldName) {
  if (!Array.isArray(costs)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return costs.reduce((total, cost, index) => {
    assertNonNegativeInteger(cost, `${fieldName}[${index}]`);
    const nextTotal = total + cost;
    if (!Number.isSafeInteger(nextTotal)) {
      throw new RangeError(`${fieldName} total exceeds the safe integer range`);
    }
    return nextTotal;
  }, 0);
}

export function calculateInventoryCost(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }

  const {
    purchasePriceKrw,
    repairCostsKrw = [],
    expenseCostsKrw = [],
    expectedSalePriceKrw = null,
    soldPriceKrw = null,
  } = input;

  assertNonNegativeInteger(purchasePriceKrw, "purchasePriceKrw");
  assertNullableNonNegativeInteger(
    expectedSalePriceKrw,
    "expectedSalePriceKrw",
  );
  assertNullableNonNegativeInteger(soldPriceKrw, "soldPriceKrw");

  const repairCostTotalKrw = sumCosts(repairCostsKrw, "repairCostsKrw");
  const expenseCostTotalKrw = sumCosts(expenseCostsKrw, "expenseCostsKrw");
  const totalCostKrw = purchasePriceKrw
    + repairCostTotalKrw
    + expenseCostTotalKrw;

  if (!Number.isSafeInteger(totalCostKrw)) {
    throw new RangeError("totalCostKrw exceeds the safe integer range");
  }

  return {
    purchasePriceKrw,
    repairCostTotalKrw,
    expenseCostTotalKrw,
    totalCostKrw,
    expectedProfitKrw: expectedSalePriceKrw === null
      ? null
      : expectedSalePriceKrw - totalCostKrw,
    realizedProfitKrw: soldPriceKrw === null
      ? null
      : soldPriceKrw - totalCostKrw,
  };
}
