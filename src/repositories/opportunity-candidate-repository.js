import { withImmediateTransaction } from "../db/transaction.js";

const SELECT = `
SELECT c.id, c.listing_id AS listingId, c.status, c.brand, c.model,
 c.variant, c.guitar_type AS guitarType,
 c.identity_confidence AS identityConfidence,
 c.reference_new_price_krw AS referenceNewPriceKrw,
 c.ratio_pct AS ratioPct, c.created_at AS createdAt,
 c.updated_at AS updatedAt, c.acquired_at AS acquiredAt,
 l.marketplace, l.external_listing_id AS externalListingId,
 l.title, l.url, l.asking_price_krw AS askingPriceKrw
FROM opportunity_candidates c
JOIN listings l ON l.id = c.listing_id
`;
const mapRow = (row) => row ? { ...row } : null;
export function findCandidateById(database, id) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return mapRow(database.prepare(`${SELECT} WHERE c.id = ?`).get(id));
}
export function findCandidateByListing(database, marketplace, externalListingId) {
  return mapRow(database.prepare(`
    ${SELECT} WHERE l.marketplace = ? AND l.external_listing_id = ?
  `).get(marketplace, externalListingId));
}
export function listActiveCandidates(database, { page = 0, pageSize = 5 } = {}) {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) ||
      pageSize < 1 || pageSize > 20) throw new TypeError("Invalid candidate page");
  const total = database.prepare(`
    SELECT COUNT(*) AS n FROM opportunity_candidates WHERE status = 'ACTIVE'
  `).get().n;
  const rows = database.prepare(`
    ${SELECT} WHERE c.status = 'ACTIVE'
    ORDER BY c.ratio_pct ASC, c.id ASC LIMIT ? OFFSET ?
  `).all(pageSize, page * pageSize).map((row) => ({ ...row }));
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function registerTrackCandidates(database, opportunities, { now = () => new Date() } = {}) {
  if (!Array.isArray(opportunities)) throw new TypeError("opportunities must be an array");
  const timestamp = now().toISOString();
  return withImmediateTransaction(database, () => {
    const results = { created: 0, existing: 0, suppressed: 0, candidates: [] };
    const seen = new Set();
    const findListing = database.prepare(
      "SELECT id FROM listings WHERE marketplace = ? AND external_listing_id = ?",
    );
    const insert = database.prepare(`
      INSERT INTO opportunity_candidates (
        listing_id, brand, model, variant, guitar_type, identity_confidence,
        reference_new_price_krw, ratio_pct, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id) DO NOTHING
    `);
    for (const opportunity of opportunities) {
      if (opportunity?.decision !== "TRACK") continue;
      const marketplace = opportunity.marketplace ?? "BUNJANG";
      const key = `${marketplace}:\u0000${opportunity.externalListingId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const listing = findListing.get(marketplace, opportunity.externalListingId);
      if (!listing) throw new Error(`TRACK listing missing from DB: ${key}`);
      const existing = findCandidateByListing(database, marketplace, opportunity.externalListingId);
      if (existing) {
        if (existing.status === "ACTIVE") {
          results.existing += 1;
          results.candidates.push(existing);
        } else results.suppressed += 1;
        continue;
      }
      const existingAcquisition = database.prepare(
        "SELECT status FROM acquisitions WHERE listing_id = ?"
      ).get(listing.id);
      if (existingAcquisition && existingAcquisition.status !== "FOUND") {
        results.suppressed += 1;
        continue;
      }
      if (!opportunity.brand || !opportunity.model
        || !["HIGH", "MEDIUM"].includes(opportunity.identityConfidence)
        || !Number.isSafeInteger(opportunity.referenceNewPriceKrw)
        || opportunity.referenceNewPriceKrw <= 0
        || !Number.isFinite(opportunity.ratioPct) || opportunity.ratioPct < 0) {
        throw new TypeError("Invalid TRACK identity/reference");
      }
      insert.run(listing.id, opportunity.brand, opportunity.model,
        opportunity.variant ?? null, opportunity.guitarType ?? "UNKNOWN",
        opportunity.identityConfidence, opportunity.referenceNewPriceKrw,
        opportunity.ratioPct, timestamp, timestamp);
      results.created += 1;
      results.candidates.push(findCandidateByListing(
        database, marketplace, opportunity.externalListingId,
      ));
    }
    return results;
  });
}

export function dismissCandidate(database, id, { now = () => new Date() } = {}) {
  return withImmediateTransaction(database, () => {
    const result = database.prepare(`
      UPDATE opportunity_candidates SET status = 'DISMISSED', updated_at = ?
      WHERE id = ? AND status = 'ACTIVE'
    `).run(now().toISOString(), id);
    return { changed: result.changes === 1, candidate: findCandidateById(database, id) };
  });
}
