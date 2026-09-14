import { calculateInventoryCost } from "../../domain/inventory/inventory-cost.js";
import { findAcquisitionById } from "../../repositories/acquisition-repository.js";
import { listExpensesByInventoryItemId } from "../../repositories/expense-repository.js";
import { findInventoryItemById } from "../../repositories/inventory-repository.js";
import { listRepairLogsByInventoryItemId } from "../../repositories/repair-repository.js";
import { listSaleListingsByInventoryItemId } from "../../repositories/sale-listing-repository.js";
import { findSaleByInventoryItemId } from "../../repositories/sale-repository.js";

export function getInventoryDetail(database, inventoryItemId) {
  const inventory = findInventoryItemById(database, inventoryItemId);
  if (!inventory) {
    return null;
  }

  const acquisition = findAcquisitionById(database, inventory.acquisitionId);
  const repairs = listRepairLogsByInventoryItemId(database, inventory.id);
  const expenses = listExpensesByInventoryItemId(database, inventory.id);
  const saleListings = listSaleListingsByInventoryItemId(
    database,
    inventory.id,
  );
  const sale = findSaleByInventoryItemId(database, inventory.id);
  const cost = calculateInventoryCost({
    purchasePriceKrw: inventory.purchasePriceKrw,
    repairCostsKrw: repairs.map(({ costKrw }) => costKrw),
    expenseCostsKrw: expenses.map(({ amountKrw }) => amountKrw),
    expectedSalePriceKrw: inventory.expectedSalePriceKrw,
    soldPriceKrw: sale?.salePriceKrw ?? null,
  });

  return {
    inventory,
    acquisition,
    repairs,
    expenses,
    saleListings,
    sale,
    cost,
  };
}
