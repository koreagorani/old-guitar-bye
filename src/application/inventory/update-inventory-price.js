import {
  updateInventoryExpectedSalePrice,
  updateInventoryPurchasePrice,
} from "../../repositories/inventory-repository.js";

export function updatePurchasePrice(database, inventoryItemId, purchasePriceKrw) {
  return updateInventoryPurchasePrice(database, inventoryItemId, purchasePriceKrw);
}

export function updateExpectedSalePrice(
  database,
  inventoryItemId,
  expectedSalePriceKrw,
) {
  return updateInventoryExpectedSalePrice(
    database,
    inventoryItemId,
    expectedSalePriceKrw,
  );
}
