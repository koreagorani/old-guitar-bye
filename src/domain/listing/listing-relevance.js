export const LISTING_RELEVANCE = Object.freeze({
  RELEVANT: "RELEVANT",
  IRRELEVANT: "IRRELEVANT",
  UNCERTAIN: "UNCERTAIN",
});

export const GUITAR_TYPE_HINT = Object.freeze({
  ACOUSTIC: "ACOUSTIC",
  ELECTRIC: "ELECTRIC",
  BASS: "BASS",
  CLASSICAL: "CLASSICAL",
  UNKNOWN: "UNKNOWN",
});

const TYPE_RULES = Object.freeze([
  {
    type: GUITAR_TYPE_HINT.ACOUSTIC,
    reason: "ACOUSTIC_KEYWORD",
    pattern: /(?:통\s*기타|어쿠스틱\s*기타|acoustic\s+guitar)/i,
  },
  {
    type: GUITAR_TYPE_HINT.CLASSICAL,
    reason: "CLASSICAL_KEYWORD",
    pattern: /(?:클래식\s*기타|classical\s+guitar|나일론\s*기타|nylon\s+string\s+guitar)/i,
  },
  {
    type: GUITAR_TYPE_HINT.BASS,
    reason: "BASS_KEYWORD",
    pattern: /(?:베이스\s*기타|베이스기타|bass\s+guitar)/i,
  },
  {
    type: GUITAR_TYPE_HINT.ELECTRIC,
    reason: "ELECTRIC_KEYWORD",
    pattern: /(?:일렉(?:트릭)?\s*기타|전기\s*기타|electric\s+guitar)/i,
  },
]);

const ACCESSORY_RULES = Object.freeze([
  {
    reason: "ACCESSORY_ONLY_CASE",
    pattern: /(?:소프트\s*케이스|하드\s*케이스|기타\s*(?:용\s*)?케이스|guitar\s*case)/i,
  },
  {
    reason: "ACCESSORY_ONLY_BAG",
    pattern: /(?:긱\s*백|gig\s*bag|기타\s*(?:용\s*)?(?:가방|백)|guitar\s*bag)/i,
  },
  {
    reason: "ACCESSORY_ONLY_STRAP",
    pattern: /(?:기타\s*(?:용\s*)?스트랩|guitar\s*strap|스트랩\s*단품)/i,
  },
  {
    reason: "ACCESSORY_ONLY_STRINGS",
    pattern: /(?:기타\s*(?:줄|현)|통기타\s*(?:줄|현)|guitar\s*strings?)/i,
  },
  {
    reason: "ACCESSORY_ONLY_PICK",
    pattern: /(?:기타\s*픽|guitar\s*picks?\b|피크\s*(?:세트|묶음|단품))/i,
  },
  {
    reason: "ACCESSORY_ONLY_CAPO",
    pattern: /(?:카포|capo\b)/i,
  },
  {
    reason: "ACCESSORY_ONLY_TUNER",
    pattern: /(?:기타\s*튜너|튜너\s*단품|guitar\s*tuner)/i,
  },
  {
    reason: "ACCESSORY_ONLY_STAND",
    pattern: /(?:기타\s*(?:용\s*)?스탠드|guitar\s*stand)/i,
  },
  {
    reason: "ACCESSORY_ONLY_PICKUP",
    pattern: /(?:픽업\s*단품|기타\s*픽업|guitar\s*pickup\b)/i,
  },
  {
    reason: "ACCESSORY_ONLY_PART",
    pattern: /(?:기타\s*(?:브릿지|브리지|너트|페그|튜닝페그)|guitar\s*(?:bridge|nut|peg)s?\b)/i,
  },
  {
    reason: "ACCESSORY_ONLY_AMP",
    pattern: /(?:기타\s*앰프|guitar\s*amp(?:lifier)?\b|앰프\s*(?:판매|팝니다|단품)?$)/i,
  },
  {
    reason: "ACCESSORY_ONLY_EFFECT",
    pattern: /(?:기타\s*이펙터|이펙터\b|effect\s*pedal|guitar\s*pedal)/i,
  },
  {
    reason: "ACCESSORY_ONLY_SHEET_MUSIC",
    pattern: /(?:기타\s*(?:악보|교본|교재)|guitar\s*(?:sheet\s*music|book))/i,
  },
  {
    reason: "ACCESSORY_ONLY_MERCH",
    pattern: /(?:기타\s*(?:굿즈|키링|장식|미니어처|피규어)|(?:굿즈|키링|피규어).*(?:기타|guitar))/i,
  },
  {
    reason: "GUITAR_SHAPED_ITEM",
    pattern: /(?:기타\s*모양|기타모양|guitar[-\s]*shaped)/i,
  },
]);

const BUNDLE_PATTERN = /(?:\+|포함|함께|같이|세트|본체\s*(?:와|및|\+))/i;
const BODY_NOUN_PATTERN = /(?:통\s*기타|어쿠스틱\s*기타|클래식\s*기타|일렉(?:트릭)?\s*기타|베이스\s*기타|\b(?:acoustic|classical|electric|bass)\s+guitar\b|(?:^|\s|[+(/])기타(?:$|\s|[+),/]))/i;
const DESCRIPTION_BODY_PATTERN = /(?:기타\s*본체|본체\s*(?:판매|팝니다|포함)|(?:통\s*기타|어쿠스틱\s*기타|클래식\s*기타|일렉\s*기타|베이스\s*기타).*(?:판매|팝니다|양도))/i;

function normalizeText(value, fieldName) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string, null, or undefined`);
  }
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectGuitarType(text) {
  for (const rule of TYPE_RULES) {
    if (rule.pattern.test(text)) {
      return { guitarType: rule.type, reason: rule.reason };
    }
  }
  return {
    guitarType: GUITAR_TYPE_HINT.UNKNOWN,
    reason: null,
  };
}

function findAccessoryReasons(title) {
  return ACCESSORY_RULES
    .filter(({ pattern }) => pattern.test(title))
    .map(({ reason }) => reason);
}

export function classifyListingRelevance({
  title,
  description = "",
}) {
  const normalizedTitle = normalizeText(title, "title");
  const normalizedDescription = normalizeText(description, "description");
  if (normalizedTitle === "") {
    throw new TypeError("title must be a non-empty string");
  }

  const combined = `${normalizedTitle} ${normalizedDescription}`.trim();
  const { guitarType, reason: typeReason } = detectGuitarType(combined);
  const reasons = [];
  if (typeReason) {
    reasons.push(typeReason);
  }

  const accessoryReasons = findAccessoryReasons(normalizedTitle);
  const titleHasBody = BODY_NOUN_PATTERN.test(normalizedTitle);
  const descriptionHasBody = DESCRIPTION_BODY_PATTERN.test(normalizedDescription);
  const hasBundleContext = BUNDLE_PATTERN.test(normalizedTitle);

  if (accessoryReasons.length > 0) {
    if (titleHasBody && hasBundleContext) {
      reasons.push("BODY_WITH_INCLUDED_ACCESSORY");
      return {
        relevance: LISTING_RELEVANCE.RELEVANT,
        guitarType,
        reasons,
      };
    }

    if (descriptionHasBody) {
      reasons.push(...accessoryReasons, "DESCRIPTION_BODY_CONTEXT");
      return {
        relevance: LISTING_RELEVANCE.UNCERTAIN,
        guitarType,
        reasons,
      };
    }

    reasons.push(...accessoryReasons);
    return {
      relevance: LISTING_RELEVANCE.IRRELEVANT,
      guitarType,
      reasons,
    };
  }

  if (titleHasBody) {
    reasons.push("GUITAR_BODY_KEYWORD");
    return {
      relevance: LISTING_RELEVANCE.RELEVANT,
      guitarType,
      reasons,
    };
  }

  if (descriptionHasBody) {
    reasons.push("DESCRIPTION_BODY_CONTEXT");
    return {
      relevance: LISTING_RELEVANCE.UNCERTAIN,
      guitarType,
      reasons,
    };
  }

  reasons.push("NO_DECISIVE_GUITAR_BODY_SIGNAL");
  return {
    relevance: LISTING_RELEVANCE.UNCERTAIN,
    guitarType,
    reasons,
  };
}
