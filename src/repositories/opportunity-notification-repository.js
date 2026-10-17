const NOTIFICATION_COLUMNS = `
  id,
  marketplace,
  external_listing_id AS externalListingId,
  notified_at AS notifiedAt,
  asking_price_krw AS askingPriceKrw,
  reference_new_price_krw AS referenceNewPriceKrw,
  ratio_pct AS ratioPct
`;

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function validateNotification(notification) {
  if (
    notification === null
    || typeof notification !== "object"
    || Array.isArray(notification)
  ) {
    throw new TypeError("notification must be an object");
  }

  for (const fieldName of [
    "marketplace",
    "externalListingId",
    "notifiedAt",
  ]) {
    assertNonEmptyString(notification[fieldName], fieldName);
  }

  if (
    !Number.isSafeInteger(notification.askingPriceKrw)
    || notification.askingPriceKrw < 0
  ) {
    throw new TypeError("askingPriceKrw must be a non-negative safe integer");
  }

  if (
    !Number.isSafeInteger(notification.referenceNewPriceKrw)
    || notification.referenceNewPriceKrw <= 0
  ) {
    throw new TypeError("referenceNewPriceKrw must be a positive safe integer");
  }

  if (!Number.isFinite(notification.ratioPct) || notification.ratioPct < 0) {
    throw new TypeError("ratioPct must be a non-negative finite number");
  }
}

export function findOpportunityNotification(
  database,
  marketplace,
  externalListingId,
) {
  assertNonEmptyString(marketplace, "marketplace");
  assertNonEmptyString(externalListingId, "externalListingId");

  const row = database.prepare(`
    SELECT ${NOTIFICATION_COLUMNS}
    FROM opportunity_notifications
    WHERE marketplace = ? AND external_listing_id = ?
  `).get(marketplace, externalListingId);

  return row ? { ...row } : null;
}

export function saveOpportunityNotification(database, notification) {
  validateNotification(notification);

  database.prepare(`
    INSERT INTO opportunity_notifications (
      marketplace,
      external_listing_id,
      notified_at,
      asking_price_krw,
      reference_new_price_krw,
      ratio_pct
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    notification.marketplace,
    notification.externalListingId,
    notification.notifiedAt,
    notification.askingPriceKrw,
    notification.referenceNewPriceKrw,
    notification.ratioPct,
  );

  return findOpportunityNotification(
    database,
    notification.marketplace,
    notification.externalListingId,
  );
}
