import { transitionAcquisition } from "../domain/acquisition/acquisition-state.js";
import { withImmediateTransaction } from "../db/transaction.js";

const ACQUISITION_COLUMNS = `
  id,
  listing_id AS listingId,
  status,
  agreed_purchase_price_krw AS agreedPurchasePriceKrw,
  bought_at AS boughtAt,
  received_at AS receivedAt,
  note
`;

function assertPositiveId(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
}

function assertNullableString(value, fieldName) {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string or null`);
  }
}

function assertTimestamp(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function normalizeRow(row) {
  return row ? { ...row } : null;
}

export function createAcquisition(database, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be an object");
  }

  const { listingId, note = null } = data;
  assertPositiveId(listingId, "listingId");
  assertNullableString(note, "note");

  const result = database.prepare(`
    INSERT INTO acquisitions (listing_id, status, note)
    VALUES (?, 'FOUND', ?)
  `).run(listingId, note);

  return findAcquisitionById(database, Number(result.lastInsertRowid));
}

export function findAcquisitionById(database, id) {
  assertPositiveId(id, "id");
  return normalizeRow(database.prepare(`
    SELECT ${ACQUISITION_COLUMNS}
    FROM acquisitions
    WHERE id = ?
  `).get(id));
}

export function findAcquisitionByListingId(database, listingId) {
  assertPositiveId(listingId, "listingId");
  return normalizeRow(database.prepare(`
    SELECT ${ACQUISITION_COLUMNS}
    FROM acquisitions
    WHERE listing_id = ?
  `).get(listingId));
}

export function updateAcquisitionState(
  database,
  id,
  nextState,
  fields = {},
) {
  assertPositiveId(id, "id");
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("fields must be an object");
  }

  const knownFields = new Set([
    "agreedPurchasePriceKrw",
    "boughtAt",
    "receivedAt",
    "note",
  ]);
  for (const fieldName of Object.keys(fields)) {
    if (!knownFields.has(fieldName)) {
      throw new TypeError(`Unknown acquisition field: ${fieldName}`);
    }
  }

  return withImmediateTransaction(database, () => {
    const current = findAcquisitionById(database, id);
    if (!current) {
      throw new Error(`Acquisition not found: ${id}`);
    }

    const validatedState = transitionAcquisition(current.status, nextState);
    const assignments = ["status = ?"];
    const values = [validatedState];

    if (nextState === "BUYING") {
      const boughtAt = fields.boughtAt ?? new Date().toISOString();
      assertTimestamp(boughtAt, "fields.boughtAt");
      assignments.push("bought_at = ?");
      values.push(boughtAt);

      if (Object.hasOwn(fields, "agreedPurchasePriceKrw")) {
        const price = fields.agreedPurchasePriceKrw;
        if (price !== null && (!Number.isSafeInteger(price) || price < 0)) {
          throw new TypeError(
            "fields.agreedPurchasePriceKrw must be a non-negative safe integer or null",
          );
        }
        assignments.push("agreed_purchase_price_krw = ?");
        values.push(price);
      }
    } else if (Object.hasOwn(fields, "boughtAt")
      || Object.hasOwn(fields, "agreedPurchasePriceKrw")) {
      throw new TypeError("Buying fields can only be set when transitioning to BUYING");
    }

    if (nextState === "RECEIVED") {
      const receivedAt = fields.receivedAt ?? new Date().toISOString();
      assertTimestamp(receivedAt, "fields.receivedAt");
      assignments.push("received_at = ?");
      values.push(receivedAt);
    } else if (Object.hasOwn(fields, "receivedAt")) {
      throw new TypeError(
        "fields.receivedAt can only be set when transitioning to RECEIVED",
      );
    }

    if (Object.hasOwn(fields, "note")) {
      assertNullableString(fields.note, "fields.note");
      assignments.push("note = ?");
      values.push(fields.note);
    }

    values.push(id);
    database.prepare(`
      UPDATE acquisitions
      SET ${assignments.join(", ")}
      WHERE id = ?
    `).run(...values);
    const updated = findAcquisitionById(database, id);
    return updated;
  });
}
