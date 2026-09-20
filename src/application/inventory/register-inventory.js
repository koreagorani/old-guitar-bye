import { withImmediateTransaction } from "../../db/transaction.js";
import {
  createAcquisition,
  updateAcquisitionState,
} from "../../repositories/acquisition-repository.js";
import { createInventoryItem } from "../../repositories/inventory-repository.js";
import { saveOrUpdateListing } from "../../repositories/listing-repository.js";

function nextInventoryCode(database) {
  const usedNumbers = database.prepare(`
    SELECT inventory_code AS inventoryCode
    FROM inventory_items
    WHERE inventory_code GLOB 'G-[0-9][0-9][0-9][0-9]'
  `).all().map(({ inventoryCode }) => Number(inventoryCode.slice(2)));
  const nextNumber = Math.max(0, ...usedNumbers) + 1;
  if (nextNumber > 9999) {
    throw new Error("No inventory codes are available");
  }
  return `G-${String(nextNumber).padStart(4, "0")}`;
}

export function registerInventory(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }

  return withImmediateTransaction(database, () => {
    const inventoryCode = nextInventoryCode(database);
    const registeredAt = data.registeredAt;
    const listing = saveOrUpdateListing(database, {
      marketplace: "MANUAL",
      externalListingId: inventoryCode,
      url: `manual://${inventoryCode}`,
      title: `${data.brand} ${data.modelName}`,
      description: "",
      askingPriceKrw: data.purchasePriceKrw,
      sellerLocationText: "직접 등록",
      discoveredAt: registeredAt,
      lastSeenAt: registeredAt,
    });
    let acquisition = createAcquisition(database, { listingId: listing.id });
    acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
      agreedPurchasePriceKrw: data.purchasePriceKrw,
      boughtAt: registeredAt,
    });
    acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
      receivedAt: registeredAt,
    });

    return createInventoryItem(database, {
      acquisitionId: acquisition.id,
      inventoryCode,
      brand: data.brand,
      modelName: data.modelName,
      guitarType: data.guitarType,
      purchasePriceKrw: data.purchasePriceKrw,
      receivedAt: registeredAt,
      expectedSalePriceKrw: data.expectedSalePriceKrw,
    });
  });
}
