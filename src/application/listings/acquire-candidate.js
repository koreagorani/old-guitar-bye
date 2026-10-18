import { withImmediateTransaction } from "../../db/transaction.js";
import { createAcquisition, findAcquisitionByListingId, updateAcquisitionState } from "../../repositories/acquisition-repository.js";
import { createInventoryItem } from "../../repositories/inventory-repository.js";
import { findCandidateById } from "../../repositories/opportunity-candidate-repository.js";
import { nextInventoryCode } from "../inventory/register-inventory.js";

export function acquireCandidate(database, {
  candidateId, purchasePriceKrw, receivedAt = new Date().toISOString(),
}) {
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) throw new TypeError("Invalid candidateId");
  if (!Number.isSafeInteger(purchasePriceKrw) || purchasePriceKrw < 0)
    throw new TypeError("purchasePriceKrw must be non-negative integer");
  if (typeof receivedAt !== "string" || !Number.isFinite(Date.parse(receivedAt)))
    throw new TypeError("Invalid receivedAt");
  return withImmediateTransaction(database, () => {
    const candidate = findCandidateById(database, candidateId);
    if (!candidate || candidate.status !== "ACTIVE") {
      return { status: "not_active", candidate };
    }
    let acquisition = findAcquisitionByListingId(database, candidate.listingId);
    if (acquisition && acquisition.status !== "FOUND") {
      return { status: "already_acquired", candidate };
    }
    if (!acquisition) acquisition = createAcquisition(database, { listingId: candidate.listingId });
    acquisition = updateAcquisitionState(database, acquisition.id, "BUYING", {
      agreedPurchasePriceKrw: purchasePriceKrw, boughtAt: receivedAt,
    });
    acquisition = updateAcquisitionState(database, acquisition.id, "RECEIVED", {
      receivedAt,
    });
    const inventory = createInventoryItem(database, {
      acquisitionId: acquisition.id,
      inventoryCode: nextInventoryCode(database),
      brand: candidate.brand,
      modelName: candidate.variant ? `${candidate.model} ${candidate.variant}` : candidate.model,
      guitarType: candidate.guitarType,
      purchasePriceKrw,
      receivedAt,
    });
    database.prepare(`
      UPDATE opportunity_candidates SET status = 'ACQUIRED', updated_at = ?, acquired_at = ?
      WHERE id = ? AND status = 'ACTIVE'
    `).run(receivedAt, receivedAt, candidateId);
    return { status: "acquired", candidate: findCandidateById(database, candidateId), inventory };
  });
}
