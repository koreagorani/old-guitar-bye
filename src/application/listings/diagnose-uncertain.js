import { classifyListingRelevance, LISTING_RELEVANCE } from "../../domain/listing/listing-relevance.js";
import { normalizeGuitarIdentity } from "../../domain/listing/guitar-identity.js";

const REASON_CONDITIONS = Object.freeze({
  NO_DECISIVE_GUITAR_BODY_SIGNAL: "제목에 확실한 기타 본체 표현이 없고, 저장된 본문에도 본체 판매 근거가 없음",
  DESCRIPTION_BODY_CONTEXT: "제목은 본체 판매를 확정하지 못하고 저장된 본문에 본체 표현이 있음",
  ACCESSORY_TITLE_WITH_GUITAR_IDENTITY: "제목에 액세서리 표현과 기타 본체 단서가 함께 있어 포함 여부가 모호함",
  ACOUSTIC_KEYWORD: "제목 또는 저장된 본문에 어쿠스틱 기타 종류 단서가 있음",
  CLASSICAL_KEYWORD: "제목 또는 저장된 본문에 클래식 기타 종류 단서가 있음",
  ELECTRIC_KEYWORD: "제목 또는 저장된 본문에 일렉 기타 종류 단서가 있음",
  BASS_KEYWORD: "제목 또는 저장된 본문에 베이스 기타 종류 단서가 있음",
});

export function redactListingText(value) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/https?:\/\/\S+/gi, "[REDACTED_LINK]")
    .replace(/(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\b0(?:2|[3-6]\d)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\b\d{6}[-.\s]?[1-4]\d{6}\b/g, "[REDACTED_ID]")
    .replace(/\b(?:\d[-.\s]?){9,16}\d\b/g, "[REDACTED_NUMBER]");
}

function safeExample(row) {
  const id = /^\d+$/.test(row.externalListingId) ? row.externalListingId : null;
  return {
    title: redactListingText(row.title),
    url: id ? `https://m.bunjang.co.kr/products/${id}` : null,
  };
}

function count(items, predicate) {
  return items.reduce((sum, item) => sum + Number(Boolean(predicate(item))), 0);
}

function percent(numerator, denominator) {
  return denominator ? Number((numerator / denominator * 100).toFixed(2)) : null;
}

function lengthDistribution(items) {
  const values = items.map(({ description }) => description.trim().length).sort((a, b) => a - b);
  const at = (fraction) => values.length ? values[Math.ceil(values.length * fraction) - 1] : null;
  return { min: values[0] ?? null, p25: at(0.25), median: at(0.5), p75: at(0.75), max: values.at(-1) ?? null };
}

function coverage(rows) {
  const total = rows.length;
  const fields = {
    titlePresent: count(rows, (row) => row.title.trim() !== ""),
    storedDescriptionPresent: count(rows, (row) => row.description.trim() !== ""),
    titleBodyExpression: count(rows, (row) => row.titleRelevance.guitarType !== "UNKNOWN"
      || /기타\s*본체|본체\s*(?:판매|양도)/i.test(row.title)),
    titleBrandDetected: count(rows, (row) => row.titleIdentity.brand !== null),
    titleModelDetected: count(rows, (row) => row.titleIdentity.model !== null),
    storedDescriptionAddsBrand: count(rows, (row) => row.description.trim() && !row.titleIdentity.brand && row.identity.brand),
    storedDescriptionAddsModel: count(rows, (row) => row.description.trim() && !row.titleIdentity.model && row.identity.model),
  };
  return {
    total,
    ...Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, { count: value, pct: percent(value, total) }])),
    storedDescriptionLength: lengthDistribution(rows),
    emptyStoredDescriptionMeaning: "MISSING_DATA: DB에 본문이 없으면 판매자 원문에 본문이 있는지 확인되지 않음",
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  }
  return hash >>> 0;
}

function sampleRow(row) {
  const missing = !row.description.trim();
  return {
    externalListingId: row.externalListingId,
    ...safeExample(row),
    lastSeenAt: row.lastSeenAt,
    relevanceReasons: row.relevance.reasons,
    brandStratum: row.titleIdentity.brand ?? "UNKNOWN",
    bodyHeuristic: row.titleRelevance.relevance === LISTING_RELEVANCE.RELEVANT
      ? "TITLE_BODY_SIGNAL" : row.relevance.reasons.includes("DESCRIPTION_BODY_CONTEXT")
        ? "STORED_DESCRIPTION_BODY_SIGNAL" : "UNDETERMINED",
    accessoryHeuristic: row.relevance.reasons.includes("ACCESSORY_TITLE_WITH_GUITAR_IDENTITY")
      ? "ACCESSORY_AND_BODY_CUES" : "UNDETERMINED",
    modelEvidence: row.titleIdentity.model ? "TITLE"
      : row.identity.model ? "STORED_DESCRIPTION_ONLY"
        : missing ? "MISSING_DATA" : "NOT_DETECTED_IN_STORED_TEXT",
    originalDetail: missing ? "MISSING_DATA" : "STORED_DESCRIPTION_PRESENT_ORIGIN_UNVERIFIED",
    manualReview: "NOT_REVIEWED",
    manualBodyClassification: "NOT_REVIEWED",
    manualModelClassification: "NOT_REVIEWED",
  };
}

// Round-robin reasons and title-brand strata; stable hash makes the sample reproducible
// without allowing the most recent or largest stratum to fill the whole sample.
function stratifiedSample(rows, size) {
  const byReason = new Map();
  for (const row of rows) {
    const reason = row.relevance.reasons.find((value) => value !== `${row.relevance.guitarType}_KEYWORD`)
      ?? row.relevance.reasons.at(-1);
    const brand = row.titleIdentity.brand ?? "UNKNOWN";
    if (!byReason.has(reason)) byReason.set(reason, new Map());
    const group = byReason.get(reason);
    if (!group.has(brand)) group.set(brand, []);
    group.get(brand).push(row);
  }
  const strata = [...byReason].sort(([a], [b]) => a.localeCompare(b)).map(([reason, brands]) => ({
    reason,
    brands: [...brands].sort(([a], [b]) => a.localeCompare(b)).map(([brand, group]) => ({
      brand,
      rows: group.sort((a, b) => stableHash(a.externalListingId) - stableHash(b.externalListingId)
        || a.externalListingId.localeCompare(b.externalListingId)),
    })),
  }));
  const selected = [];
  while (selected.length < size) {
    let added = 0;
    for (const stratum of strata) {
      const brand = stratum.brands.find((entry) => entry.rows.length);
      if (!brand) continue;
      selected.push(sampleRow(brand.rows.shift()));
      stratum.brands.push(stratum.brands.splice(stratum.brands.indexOf(brand), 1)[0]);
      added += 1;
      if (selected.length === size) break;
    }
    if (!added) break;
  }
  return selected;
}

export function diagnoseUncertain({ listings, now = () => new Date(), lookbackDays = 30, sampleSize = 100 }) {
  if (!Array.isArray(listings)) throw new TypeError("listings must be an array");
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 1) throw new TypeError("lookbackDays must be positive");
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 1 || sampleSize > 100) {
    throw new TypeError("sampleSize must be between 1 and 100");
  }
  const time = now();
  if (!(time instanceof Date) || Number.isNaN(time.getTime())) throw new TypeError("now must return a valid Date");
  const cutoff = new Date(time.getTime() - lookbackDays * 86400000).toISOString();
  const rows = listings.filter(({ lastSeenAt }) => typeof lastSeenAt === "string" && lastSeenAt >= cutoff)
    .map((listing) => {
      const titleRelevance = classifyListingRelevance({ title: listing.title });
      const relevance = classifyListingRelevance(listing);
      const titleIdentity = normalizeGuitarIdentity({ title: listing.title });
      const identity = normalizeGuitarIdentity({ title: listing.title, description: listing.description });
      return { ...listing, description: listing.description ?? "", titleRelevance, relevance, titleIdentity, identity };
    }).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)
      || a.externalListingId.localeCompare(b.externalListingId));
  const groups = Object.fromEntries(Object.values(LISTING_RELEVANCE).map((value) =>
    [value, rows.filter((row) => row.relevance.relevance === value)]));
  const uncertain = groups.UNCERTAIN;
  const reasons = new Map();
  for (const row of uncertain) {
    for (const reason of row.relevance.reasons) {
      if (!reasons.has(reason)) reasons.set(reason, { count: 0, examples: [] });
      const entry = reasons.get(reason);
      entry.count += 1;
      if (entry.examples.length < 3) entry.examples.push(safeExample(row));
    }
  }
  return {
    cutoff,
    lookbackDays,
    counts: Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, group.length])),
    uncertainReasons: Object.fromEntries([...reasons].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(([reason, entry]) => [reason, {
        ...entry,
        pctOfUncertain: percent(entry.count, uncertain.length),
        directCondition: REASON_CONDITIONS[reason] ?? "분류기에서 부여한 보조 근거. 정확한 조건은 listing-relevance.js 참조",
      }])),
    dataCoverage: {
      all: coverage(rows),
      relevant: coverage(groups.RELEVANT),
      uncertain: coverage(uncertain),
    },
    sampleMethod: "최근 기간, relevance reason × 제목에서 인식한 브랜드 층화. ID 고정 해시 순, 라운드로빈, 최대 100건",
    sample: stratifiedSample(uncertain, sampleSize),
    sampleManualReview: "NOT_REVIEWED",
  };
}
