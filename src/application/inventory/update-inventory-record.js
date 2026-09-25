import { updateExpense } from "../../repositories/expense-repository.js";
import { updateRepairLog } from "../../repositories/repair-repository.js";

export function updateRepairRecord(
  database,
  inventoryItemId,
  repairLogId,
  changes,
) {
  return updateRepairLog(database, inventoryItemId, repairLogId, changes);
}

export function updateExpenseRecord(
  database,
  inventoryItemId,
  expenseId,
  changes,
) {
  return updateExpense(database, inventoryItemId, expenseId, changes);
}
