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

function detectBrand(text) {
  if (text === "") {
    return null;
  }

  const matches = [];
  for (const brand of GUITAR_BRANDS) {
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

function stripBrandAliases(text) {
  let stripped = text;
  for (const aliases of Object.values(GUITAR_BRAND_ALIASES)) {
    for (const alias of aliases) {
      const escaped = escapeRegex(alias).replace(/\s+/g, "\\s*");
      stripped = stripped.replace(new RegExp(escaped, "gi"), " ");
    }
  }
  return stripped.replace(/\s+/g, " ").trim();
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

function detectModel(text, brand = null) {
  if (text === "") {
    return null;
  }

  const upper = stripBrandAliases(text).toUpperCase();

  if (brand) {
    const brandAware = matchBrandModelRule(brand, upper);
    if (brandAware) {
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
      if (canonical) {
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

function detectDescriptionModel(description, brand = null) {
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
    .map((context) => detectModel(context, brand))
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
  const descriptionBrand = detectBrand(normalizedDescription);
  const titleModel = detectModel(
    normalizedTitle,
    titleBrand?.conflict ? null : titleBrand?.brand ?? null,
  );
  const descriptionModel = detectDescriptionModel(
    normalizedDescription,
    descriptionBrand?.conflict
      ? null
      : (titleBrand?.conflict ? null : titleBrand?.brand)
        ?? descriptionBrand?.brand
        ?? null,
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
