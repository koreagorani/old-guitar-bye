import {
  GUITAR_BRAND_ALIASES,
  GUITAR_BRANDS,
} from "./guitar-brand-aliases.js";
import { matchBrandModelRule } from "./guitar-model-patterns.js";

export const IDENTITY_CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

const GUITAR_TYPES = new Set([
  "ACOUSTIC",
  "ELECTRIC",
  "BASS",
  "CLASSICAL",
  "UNKNOWN",
]);

const KNOWN_TEXT_MODELS = Object.freeze([
  {
    pattern: /\bOMEGA\s+CSP\s+PLUS\b/i,
    canonical: "OMEGA CSP PLUS",
  },
]);

const MODEL_PATTERNS = Object.freeze([
  /\b([A-Z]{1,12})\s*[- ]?\s*(\d{2,5})([A-Z]{0,4})\b/i,
  /\b(\d{2,4})([A-Z]{1,4})\b/i,
]);

const MEASUREMENT_CODE = /^\d{1,4}(?:W|WATT|IN|INCH|CM|MM|KG|GB|TB|K|EA|PCS)$/i;
const ACCESSORY_CONTEXT = /(?:앰프|스피커|케이스|가방|소프트\s*백|픽업|이펙터|튜너|거치대|스탠드|페달|컨트롤러|마이크)/gi;
const BODY_CONTEXT = /(?:기타|\b(?:guitar|bass)\b)/gi;

function normalizeText(value, fieldName) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new TypeError(fieldName + " must be a string, null, or undefined");
  }
  return value
    .normalize("NFKC")
    .replace(/[＿_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^()|[\]\\{}$]/g, "\\$&");
}

function aliasRegex(alias, flags = "i") {
  const escaped = escapeRegex(alias).replace(/\s+/g, "\\s*");
  if (/^[A-Z0-9 ]+$/i.test(alias)) {
    return new RegExp("(?:^|[^A-Z0-9])" + escaped + "(?=$|[^A-Z0-9])", flags);
  }
  return new RegExp(escaped, flags);
}

// Corona also names a city and appears in unrelated descriptions.
const CORONA_GUITAR_CONTEXT = /(?:^|[^A-Z0-9가-힣])(?:CORONA|코로나)\s*[\])]?\s*(?:일렉(?:트릭)?\s*기타|베이스\s*기타|electric\s+guitar|bass\s+guitar)/i;

function detectBrand(text) {
  if (text === "") {
    return null;
  }

  const matches = [];
  for (const brand of GUITAR_BRANDS) {
    if (brand === "CORONA" && !CORONA_GUITAR_CONTEXT.test(text)) continue;
    for (const alias of GUITAR_BRAND_ALIASES[brand]) {
      if (aliasRegex(alias).test(text)) {
        matches.push({ brand, alias });
        break;
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    return {
      conflict: true,
      brands: matches.map(({ brand }) => brand),
    };
  }

  return {
    conflict: false,
    brand: matches[0].brand,
    alias: matches[0].alias,
  };
}

function detectDescriptionBrand(description) {
  if (description === "") {
    return null;
  }

  const contexts = [];
  const pattern = /(?:브랜드|brand|제조사)\s*(?::|=|은|는)?\s*([^\n,.]{1,40})/gi;
  for (const match of description.matchAll(pattern)) {
    contexts.push(match[1]);
  }
  if (contexts.length === 0) {
    return null;
  }

  const matches = contexts
    .map((context) => detectBrand(context))
    .filter(Boolean);

  const brands = [...new Set(matches.flatMap((match) => (
    match.conflict ? match.brands : [match.brand]
  )))];

  if (brands.length === 0) {
    return null;
  }
  if (brands.length > 1) {
    return { conflict: true, brands };
  }
  return {
    conflict: false,
    brand: brands[0],
    alias: null,
  };
}

function stripBrandAliases(text) {
  let stripped = text;
  for (const [brand, aliases] of Object.entries(GUITAR_BRAND_ALIASES)) {
    if (brand === "CORONA") continue;
    for (const alias of aliases) {
      const escaped = escapeRegex(alias).replace(/\s+/g, "\\s*");
      stripped = stripped.replace(new RegExp(escaped, "gi"), " ");
    }
  }
  return stripped.replace(/\s+/g, " ").trim();
}

function isLikelyNoiseModel(model) {
  if (/^(?:19|20)\d{2}$/.test(model)) {
    return true;
  }
  if (/^(?:BLACK|WHITE|BLUE|RED|GREEN|JET|NATURAL|NAT)\d{2,5}$/i.test(model)) {
    return true;
  }
  if (/^\d{5,}$/.test(model)) {
    return true;
  }
  return false;
}

function canonicalizeModelMatch(match) {
  if (!match) {
    return null;
  }

  if (match[1] && match[2] && /^[A-Z]+$/i.test(match[1])) {
    return (
      match[1].toUpperCase()
      + match[2]
      + (match[3] ?? "").toUpperCase()
    );
  }

  if (match[1] && match[2] && /^\d+$/.test(match[1])) {
    return match[1] + match[2].toUpperCase();
  }

  return null;
}

function nearestDistance(text, regex, start, end) {
  let nearest = Infinity;
  for (const match of text.matchAll(regex)) {
    const markerStart = match.index;
    const markerEnd = markerStart + match[0].length;
    nearest = Math.min(nearest, Math.max(markerStart - end, start - markerEnd, 0));
  }
  return nearest;
}

function candidateNoiseReason(text, start, end, model) {
  if (MEASUREMENT_CODE.test(model)) return "MODEL_CANDIDATE_MEASUREMENT";
  const nearby = text.slice(Math.max(0, start - 12), Math.min(text.length, end + 12));
  if (/(?:19|20)\d{2}/.test(model)
    && /(?:연식|년식|구입|구매|제조|생산|\bYEAR\b)/i.test(nearby)) {
    return "MODEL_CANDIDATE_YEAR_CONTEXT";
  }
  const accessoryDistance = nearestDistance(text, ACCESSORY_CONTEXT, start, end);
  const bodyDistance = nearestDistance(text, BODY_CONTEXT, start, end);
  if (accessoryDistance <= 10 && accessoryDistance < bodyDistance) {
    return "MODEL_CANDIDATE_ACCESSORY_CONTEXT";
  }
  return null;
}

function detectModel(text, brand = null, checkOtherModels = true, rejected = []) {
  if (text === "") {
    return null;
  }

  const upper = stripBrandAliases(text).toUpperCase();

  // Recognize the Corona brand without treating arbitrary nearby codes as verified models.
  if (brand === "CORONA") return null;
  if (brand) {
    const brandAware = matchBrandModelRule(brand, upper);
    if (brandAware) {
      if (brandAware.checkOtherModels && checkOtherModels) {
        const remainder = upper.replaceAll(brandAware.raw, " ");
        const other = detectModel(remainder, brand, false, rejected);
        if (other?.conflict || (other && other.model !== brandAware.model)) {
          return {
            conflict: true,
            models: [brandAware.model, ...(other.models ?? [other.model])],
          };
        }
      }
      return brandAware;
    }
  }

  for (const rule of KNOWN_TEXT_MODELS) {
    const match = upper.match(rule.pattern);
    if (match) {
      return {
        conflict: false,
        model: rule.canonical,
        raw: match[0],
      };
    }
  }

  const candidates = [];
  const occupied = [];
  for (const [patternIndex, pattern] of MODEL_PATTERNS.entries()) {
    const regex = new RegExp(pattern.source, "gi");
    for (const match of upper.matchAll(regex)) {
      const start = match.index ?? -1;
      const end = start + match[0].length;
      if (
        patternIndex > 0
        && occupied.some(([occupiedStart, occupiedEnd]) => (
          start >= occupiedStart && end <= occupiedEnd
        ))
      ) {
        continue;
      }
      const canonical = canonicalizeModelMatch(match);
      const rejection = canonical && candidateNoiseReason(upper, start, end, canonical);
      if (rejection) rejected.push(rejection);
      if (canonical && !rejection && !isLikelyNoiseModel(canonical)) {
        candidates.push({
          model: canonical,
          variant: null,
          raw: match[0],
        });
        if (patternIndex === 0) occupied.push([start, end]);
      }
    }
  }

  const unique = [...new Map(
    candidates.map((candidate) => [candidate.model, candidate]),
  ).values()];

  if (unique.length === 0) {
    return null;
  }
  if (unique.length > 1) {
    return {
      conflict: true,
      models: unique.map(({ model }) => model),
    };
  }

  return {
    conflict: false,
    ...unique[0],
  };
}

function detectDescriptionModel(description, brand = null, rejected = []) {
  if (description === "") {
    return null;
  }

  const contexts = [];
  const pattern = /(?:모델(?:명)?|model)\s*(?:은|는|:|=|-)?\s*([^\n,.]{1,40})/gi;
  for (const match of description.matchAll(pattern)) {
    contexts.push(match[1]);
  }

  if (contexts.length === 0) {
    return null;
  }

  const models = contexts
    .map((context) => detectModel(context, brand, true, rejected))
    .filter(Boolean);

  if (models.some((model) => model.conflict)) {
    return {
      conflict: true,
      models: models.flatMap((model) => model.models ?? [model.model]),
    };
  }

  const unique = [...new Map(
    models.map((model) => [model.model, model]),
  ).values()];

  if (unique.length === 0) {
    return null;
  }
  if (unique.length > 1) {
    return {
      conflict: true,
      models: unique.map(({ model }) => model),
    };
  }

  return unique[0];
}

function resolveBrand(titleBrand, descriptionBrand, reasons) {
  if (titleBrand?.conflict || descriptionBrand?.conflict) {
    reasons.push("MULTIPLE_BRANDS_IN_SOURCE");
    return { brand: null, source: null, conflict: true };
  }

  if (
    titleBrand?.brand
    && descriptionBrand?.brand
    && titleBrand.brand !== descriptionBrand.brand
  ) {
    reasons.push("TITLE_DESCRIPTION_BRAND_CONFLICT");
    return { brand: null, source: null, conflict: true };
  }

  if (titleBrand?.brand) {
    reasons.push("BRAND_FROM_TITLE");
    if (descriptionBrand?.brand === titleBrand.brand) {
      reasons.push("BRAND_CONFIRMED_BY_DESCRIPTION");
    }
    return {
      brand: titleBrand.brand,
      source: "title",
      conflict: false,
    };
  }

  if (descriptionBrand?.brand) {
    reasons.push("BRAND_FROM_DESCRIPTION");
    return {
      brand: descriptionBrand.brand,
      source: "description",
      conflict: false,
    };
  }

  reasons.push("BRAND_NOT_FOUND");
  return { brand: null, source: null, conflict: false };
}

function modelWasCanonicalized(raw, canonical) {
  if (!raw) {
    return false;
  }
  return raw.toUpperCase() !== canonical.toUpperCase();
}

function resolveModel(titleModel, descriptionModel, reasons) {
  if (titleModel?.conflict || descriptionModel?.conflict) {
    reasons.push("MULTIPLE_MODELS_IN_SOURCE");
    return { model: null, variant: null, source: null, conflict: true };
  }

  if (
    titleModel?.model
    && descriptionModel?.model
    && titleModel.model !== descriptionModel.model
  ) {
    reasons.push("TITLE_DESCRIPTION_MODEL_CONFLICT");
    return { model: null, variant: null, source: null, conflict: true };
  }

  if (titleModel?.model) {
    reasons.push("MODEL_FROM_TITLE");
    if (modelWasCanonicalized(titleModel.raw, titleModel.model)) {
      reasons.push("MODEL_CANONICALIZED");
    }
    if (descriptionModel?.model === titleModel.model) {
      reasons.push("MODEL_CONFIRMED_BY_DESCRIPTION");
    }
    return {
      model: titleModel.model,
      variant: titleModel.variant ?? null,
      source: "title",
      conflict: false,
    };
  }

  if (descriptionModel?.model) {
    reasons.push("MODEL_FROM_DESCRIPTION");
    if (modelWasCanonicalized(descriptionModel.raw, descriptionModel.model)) {
      reasons.push("MODEL_CANONICALIZED");
    }
    return {
      model: descriptionModel.model,
      variant: descriptionModel.variant ?? null,
      source: "description",
      conflict: false,
    };
  }

  reasons.push("MODEL_NOT_FOUND");
  return { model: null, variant: null, source: null, conflict: false };
}

function confidenceFor({
  brand,
  model,
  brandSource,
  modelSource,
  conflict,
}) {
  if (conflict) {
    return IDENTITY_CONFIDENCE.LOW;
  }
  if (
    brand
    && model
    && brandSource === "title"
    && modelSource === "title"
  ) {
    return IDENTITY_CONFIDENCE.HIGH;
  }
  if (brand && model) {
    return IDENTITY_CONFIDENCE.MEDIUM;
  }
  return IDENTITY_CONFIDENCE.LOW;
}

export function normalizeGuitarIdentity({
  title,
  description = "",
  guitarType = "UNKNOWN",
}) {
  const normalizedTitle = normalizeText(title, "title");
  const normalizedDescription = normalizeText(description, "description");

  if (normalizedTitle === "") {
    throw new TypeError("title must be a non-empty string");
  }
  if (!GUITAR_TYPES.has(guitarType)) {
    throw new TypeError("Unknown guitarType: " + String(guitarType));
  }

  const reasons = [];
  if (guitarType !== "UNKNOWN") {
    reasons.push("GUITAR_TYPE_" + guitarType);
  }

  const titleBrand = detectBrand(normalizedTitle);
  const descriptionBrand = detectDescriptionBrand(normalizedDescription);
  const rejectedCandidates = [];
  const titleModel = detectModel(
    normalizedTitle,
    titleBrand?.conflict ? null : titleBrand?.brand ?? null,
    true,
    rejectedCandidates,
  );
  const descriptionModel = detectDescriptionModel(
    normalizedDescription,
    descriptionBrand?.conflict
      ? null
      : (titleBrand?.conflict ? null : titleBrand?.brand)
        ?? descriptionBrand?.brand
        ?? null,
    rejectedCandidates,
  );

  const resolvedBrand = resolveBrand(
    titleBrand,
    descriptionBrand,
    reasons,
  );
  const resolvedModel = resolveModel(
    titleModel,
    descriptionModel,
    reasons,
  );
  reasons.push(...new Set(rejectedCandidates));
  const conflict = resolvedBrand.conflict || resolvedModel.conflict;

  return {
    brand: resolvedBrand.brand,
    model: resolvedModel.model,
    variant: resolvedModel.variant,
    confidence: confidenceFor({
      brand: resolvedBrand.brand,
      model: resolvedModel.model,
      brandSource: resolvedBrand.source,
      modelSource: resolvedModel.source,
      conflict,
    }),
    reasons,
  };
}
