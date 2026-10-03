export const GUITAR_BRAND_ALIASES = Object.freeze({
  YAMAHA: Object.freeze(["YAMAHA", "야마하"]),
  CORT: Object.freeze(["CORT", "콜트"]),
  CRAFTER: Object.freeze(["CRAFTER", "크래프터"]),
  GOPHERWOOD: Object.freeze(["GOPHERWOOD", "고퍼우드"]),
  MARTIN: Object.freeze(["MARTIN", "마틴"]),
  TAYLOR: Object.freeze(["TAYLOR", "테일러"]),
  FENDER: Object.freeze(["FENDER", "펜더"]),
  GIBSON: Object.freeze(["GIBSON", "깁슨"]),
  TAKAMINE: Object.freeze(["TAKAMINE", "다카미네", "타카미네"]),
  IBANEZ: Object.freeze(["IBANEZ", "아이바네즈"]),
  EPIPHONE: Object.freeze(["EPIPHONE", "에피폰"]),
  HEX: Object.freeze(["HEX", "헥스"]),
  DEXTER: Object.freeze(["DEXTER", "덱스터"]),
  SAMICK: Object.freeze(["SAMICK", "삼익"]),
  SEGOVIA: Object.freeze(["SEGOVIA", "세고비아"]),
});

export const GUITAR_BRANDS = Object.freeze(
  Object.keys(GUITAR_BRAND_ALIASES),
);
