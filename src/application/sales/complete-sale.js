import { withImmediateTransaction } from "../../db/transaction.js";
import { transitionInventory } from "../../domain/inventory/inventory-state.js";
import {
  findInventoryItemById,
  updateInventoryState,
} from "../../repositories/inventory-repository.js";
import {
  closeSaleListing,
  findSaleListingById,
} from "../../repositories/sale-listing-repository.js";
import { createSale } from "../../repositories/sale-repository.js";

export function completeSale(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }

  const {
    inventoryItemId,
    saleListingId = null,
    soldAt,
  } = data;

  return withImmediateTransaction(database, () => {
    const inventoryItem = findInventoryItemById(database, inventoryItemId);
    if (!inventoryItem) {
      throw new Error(`Inventory item not found: ${inventoryItemId}`);
    }

    transitionInventory(inventoryItem.state, "SOLD");

    let saleListing = null;
    if (saleListingId !== null) {
      saleListing = findSaleListingById(database, saleListingId);
      if (!saleListing) {
        throw new Error(`Sale listing not found: ${saleListingId}`);
      }
      if (saleListing.inventoryItemId !== inventoryItemId) {
        throw new Error(
          `Sale listing ${saleListingId} does not belong to inventory item ${inventoryItemId}`,
        );
      }
      if (saleListing.closedAt !== null) {
        throw new Error(`Sale listing already closed: ${saleListingId}`);
      }
    }

    const sale = createSale(database, data);
    const closedSaleListing = saleListing === null
      ? null
      : closeSaleListing(database, saleListing.id, soldAt);
    const soldInventoryItem = updateInventoryState(
      database,
      inventoryItemId,
      "SOLD",
    );

    return {
      sale,
      saleListing: closedSaleListing,
      inventoryItem: soldInventoryItem,
    };
  });
}
