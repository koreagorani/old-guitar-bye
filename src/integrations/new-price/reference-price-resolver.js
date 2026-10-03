import {
  evaluateReferencePriceCandidate,
  resolveReferenceNewPrice,
} from "../../domain/listing/reference-new-price.js";

function assertSource(source) {
  if (!source || typeof source.id !== "string" || typeof source.search !== "function") {
    throw new TypeError("each reference source must expose id and search()");
  }
}

export function createReferenceNewPriceResolver({
  sources,
  now = () => new Date(),
}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new TypeError("sources must be a non-empty array");
  }
  sources.forEach(assertSource);

  const cache = new Map();

  async function searchSource(source, brand, observedAt) {
    const key = `${source.id}:${brand}`;
    if (!cache.has(key)) {
      cache.set(key, source.search({ brand, observedAt }));
    }
    return cache.get(key);
  }

  return {
    clearCache() {
      cache.clear();
    },

    async resolve({ brand, model }) {
      const observedAt = now().toISOString();
      const evaluated = [];
      const sourceErrors = [];

      for (const source of sources) {
        try {
          const result = await searchSource(source, brand, observedAt);
          for (const product of result.products) {
            evaluated.push(evaluateReferencePriceCandidate({
              brand,
              model,
              ...product,
              observedAt: product.observedAt ?? observedAt,
            }));
          }
        } catch (error) {
          sourceErrors.push({
            source: source.id,
            name: error?.name ?? "Error",
            message: error?.message ?? String(error),
          });
        }
      }

      return {
        ...resolveReferenceNewPrice({
          brand,
          model,
          candidates: evaluated,
        }),
        sourceErrors,
      };
    },
  };
}
