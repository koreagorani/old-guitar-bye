import { getInventoryDetail } from "../inventory/get-inventory-detail.js";
import {
  findValidSaleById,
  listValidSalesPage,
} from "../../repositories/sale-repository.js";

export function listSalesPage(database, options = {}) {
  const page = listValidSalesPage(database, options);
  return { ...page, rows: page.rows.map(sale => ({
    ...sale,
    realizedProfitKrw: sale.salePriceKrw -
      getInventoryDetail(database, sale.inventoryItemId).cost.totalCostKrw,
  })) };
}

export function getSaleDetail(database, saleId) {
  const sale = findValidSaleById(database, saleId);
  if (!sale) return null;
  const detail = getInventoryDetail(database, sale.inventoryItemId);
  return { sale, inventory: detail.inventory, cost: detail.cost };
}
