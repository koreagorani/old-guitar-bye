import {
  restoreSoldInventoryForSale,
} from "../../repositories/inventory-repository.js";

export function cancelSale(database, inventoryItemId) {
  return restoreSoldInventoryForSale(database, inventoryItemId);
}
