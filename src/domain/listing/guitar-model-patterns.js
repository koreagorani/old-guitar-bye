export const GUITAR_MODEL_RULES = Object.freeze({
  CORT: Object.freeze([
    {
      id: "CORT_L100_O",
      pattern: /\bL\s*100\s*[- ]?\s*O(?:\s+(NS|NAT))?\b/i,
      build: (match) => ({ model: "L100-O", variant: match[1]?.toUpperCase() ?? null }),
    },
    {
      id: "CORT_EARTH",
      pattern: /(?:\bEARTH|어스)\s*[- ]?\s*(\d{2,4})\b/i,
      build: (match) => ({ model: `EARTH${match[1]}`, variant: null }),
    },
    {
      id: "CORT_AD",
      pattern: /\bAD\s*[- ]?\s*(\d{3,4})\b/i,
      build: (match) => ({ model: `AD${match[1]}`, variant: null }),
    },
  ]),
  CRAFTER: Object.freeze([
    {
      id: "CRAFTER_HT100",
      pattern: /\bHT\s*[- ]?\s*100(?:\s*[/ -]\s*(OP\.N|OPN|NAT|NS))?\b/i,
      build: (match) => ({
        model: "HT100",
        variant: match[1]?.toUpperCase() ?? null,
      }),
    },
    {
      id: "CRAFTER_SURE_PLUS",
      pattern: /\bSURE\s+PLUS\b/i,
      build: () => ({ model: "SURE PLUS", variant: null }),
    },
    {
      id: "CRAFTER_OMEGA_CSP_PLUS",
      pattern: /\bOMEGA\s+CSP\s+PLUS\b/i,
      build: () => ({ model: "OMEGA CSP PLUS", variant: null }),
    },
    {
      id: "CRAFTER_DX25",
      pattern: /\bDX\s*[- ]?\s*25(?:\s+(RS\s+PRIME|RS\s+PRIMR))?\b/i,
      build: (match) => ({
        model: "DX25",
        variant: match[1] ? match[1].toUpperCase().replace("PRIMR", "PRIME") : null,
      }),
    },
  ]),
  GOPHERWOOD: Object.freeze([
    {
      id: "GOPHERWOOD_S_CLASSIC_V",
      pattern: /\bS\s*[- ]?\s*CLASSIC\s+V(?:\s+(2G|2ND\s+GEN(?:ERATION)?))?(?:\s+(JET\s+BLACK|FLORAL\s+WHITE|URANUS\s+BLUE|SCARLET|BATTLESHIP\s+GRAY|LAVENDER))?/i,
      build: (match) => ({
        model: match[1] ? "S CLASSIC V 2G" : "S CLASSIC V",
        variant: match[2]?.toUpperCase() ?? null,
      }),
    },
    {
      id: "GOPHERWOOD_K330RCE",
      pattern: /\bK\s*330\s*RCE\b/i,
      build: () => ({ model: "K330RCE", variant: null }),
    },
    {
      id: "GOPHERWOOD_G110",
      pattern: /\bG\s*110\b/i,
      build: () => ({ model: "G110", variant: null }),
    },
  ]),
  DEXTER: Object.freeze([
    {
      id: "DEXTER_DOM16",
      pattern: /\bDOM\s*[- ]?\s*16(?:\s*[- ]?\s*(MOP|SOP)|M\s*[- ]?\s*(OP))?\b/i,
      build: (match) => ({
        model: "DOM16",
        variant: (match[1] ?? (match[2] ? `M${match[2]}` : null))?.toUpperCase() ?? null,
      }),
    },
  ]),
  YAMAHA: Object.freeze([
    {
      id: "YAMAHA_SLG200S",
      pattern: /\bSLG\s*[- ]?\s*200\s*S\b/i,
      build: () => ({ model: "SLG200S", variant: null }),
    },
  ]),
  EPIPHONE: Object.freeze([
    {
      id: "EPIPHONE_PR150",
      pattern: /\bPR\s*[- ]?\s*150(?:\s+(NA|NAT|VS))?\b/i,
      build: (match) => ({ model: "PR150", variant: match[1]?.toUpperCase() ?? null }),
    },
    {
      id: "EPIPHONE_EJ200",
      pattern: /\bEJ\s*[- ]?\s*200\b/i,
      build: () => ({ model: "EJ200", variant: null }),
    },
  ]),
  TAKAMINE: Object.freeze([]),
  DAME: Object.freeze([
    {
      id: "DAME_LILIES70",
      pattern: /\bLILIES\s*[- ]?\s*70\b/i,
      build: () => ({ model: "LILIES70", variant: null }),
    },
  ]),
  HOFNER: Object.freeze([
    {
      id: "HOFNER_HAS_D01CERD",
      pattern: /\bHAS\s*[- ]?\s*D\s*[- ]?\s*01\s*CE\s*RD\b/i,
      build: () => ({ model: "HAS-D01CERD", variant: null }),
    },
  ]),
  SCHECTER: Object.freeze([
    {
      id: "SCHECTER_C6_PRO",
      pattern: /\bC\s*[- ]?\s*6\s+PRO\b/i,
      build: () => ({ model: "C6 PRO", variant: null }),
    },
  ]),
  COUNTESS: Object.freeze([
    {
      id: "COUNTESS_D7",
      pattern: /\bD\s*[- ]?\s*7\b/i,
      build: () => ({ model: "D7", variant: null }),
    },
  ]),
  OLIVIA: Object.freeze([
    {
      id: "OLIVIA_AEQ41",
      pattern: /\bAEQ\s*[- ]?\s*41\b/i,
      build: () => ({ model: "AEQ41", variant: null }),
    },
  ]),
  ORANGEWOOD: Object.freeze([]),
  OVATION: Object.freeze([]),
});

export function matchBrandModelRule(brand, text) {
  const rules = GUITAR_MODEL_RULES[brand] ?? [];
  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    return {
      conflict: false,
      ...rule.build(match),
      raw: match[0],
      ruleId: rule.id,
    };
  }
  return null;
}
