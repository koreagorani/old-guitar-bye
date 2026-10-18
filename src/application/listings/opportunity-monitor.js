import {
  evaluateBunjangOpportunities,
} from "./evaluate-bunjang-opportunities.js";
import { registerTrackCandidates } from "../../repositories/opportunity-candidate-repository.js";
import { listListingsByMarketplace } from "../../repositories/listing-repository.js";
import {
  collectBunjangListingCandidates,
  persistBunjangListingCandidates,
} from "../../integrations/bunjang/bunjang-collector.js";
import { loadBunjangConfig } from "../../integrations/bunjang/bunjang-config.js";

export class OpportunityMonitorError extends Error {
  constructor(stage, cause) {
    super(`Opportunity monitor failed during ${stage}: ${cause?.message ?? String(cause)}`, {
      cause,
    });
    this.name = "OpportunityMonitorError";
    this.stage = stage;
  }
}

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(value, fallback, fieldName) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${fieldName} must be a non-negative number`);
  }
  return parsed;
}

export function loadOpportunityMonitorConfig(env = process.env) {
  return {
    bunjang: loadBunjangConfig(env),
    lookbackDays: parsePositiveInteger(
      env.OPPORTUNITY_LOOKBACK_DAYS,
      30,
      "OPPORTUNITY_LOOKBACK_DAYS",
    ),
    thresholdPct: parseNonNegativeNumber(
      env.OPPORTUNITY_THRESHOLD_PCT,
      12,
      "OPPORTUNITY_THRESHOLD_PCT",
    ),
  };
}

function fixedNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("now() must return a valid Date");
  }
  return () => new Date(value.getTime());
}

export async function runBunjangOpportunityMonitor({
  database,
  client,
  resolver,
  notifier = null,
  config,
  now = () => new Date(),
}) {
  if (!database) throw new TypeError("database is required");
  if (!client || typeof client.search !== "function") {
    throw new TypeError("client.search must be a function");
  }
  if (!resolver || typeof resolver.resolve !== "function") {
    throw new TypeError("resolver.resolve must be a function");
  }
  if (!config || typeof config !== "object") {
    throw new TypeError("config is required");
  }

  const runNow = fixedNow(now);
  let collected;
  try {
    collected = await collectBunjangListingCandidates({
      client,
      ...config.bunjang,
      now: runNow,
    });
  } catch (error) {
    throw new OpportunityMonitorError("COLLECT", error);
  }

  let persisted;
  try {
    persisted = persistBunjangListingCandidates(
      database,
      collected.candidates,
      { lastSeenAt: collected.discoveredAt },
    );
  } catch (error) {
    throw new OpportunityMonitorError("PERSIST", error);
  }

  let evaluation;
  try {
    evaluation = await evaluateBunjangOpportunities({
      listings: listListingsByMarketplace(database, "BUNJANG"),
      resolver,
      lookbackDays: config.lookbackDays,
      thresholdPct: config.thresholdPct,
      now: runNow,
    });
  } catch (error) {
    throw new OpportunityMonitorError("EVALUATE", error);
  }

  let candidateSummary;
  try {
    candidateSummary = registerTrackCandidates(database, evaluation.track, { now: runNow });
  } catch (error) {
    throw new OpportunityMonitorError("CANDIDATES", error);
  }

  let notifierSummary = {
    sent: 0,
    duplicate: 0,
    failed: 0,
    failures: [],
  };
  if (notifier !== null) {
    if (typeof notifier.notify !== "function") {
      throw new TypeError("notifier.notify must be a function");
    }
    try {
      notifierSummary = await notifier.notify(candidateSummary.candidates);
    } catch (error) {
      throw new OpportunityMonitorError("NOTIFY", error);
    }
  }

  return {
    collector: {
      candidateCount: collected.candidates.length,
      savedCount: persisted.saved.length,
      skippedCount: persisted.skipped.length,
      skipped: persisted.skipped,
      sourceCount: collected.sources.length,
    },
    evaluator: evaluation,
    candidates: candidateSummary,
    notifier: notifierSummary,
  };
}

function formatKrw(value) {
  return Number(value).toLocaleString("ko-KR");
}

export function formatOpportunityMonitorLog(result) {
  const lines = [
    `[collector] candidates=${result.collector.candidateCount} saved=${result.collector.savedCount} skipped=${result.collector.skippedCount}`,
    `[evaluator] track=${result.evaluator.summary.track} ignore=${result.evaluator.summary.ignore} unresolvedIdentity=${result.evaluator.summary.identityUnresolved} unresolvedReference=${result.evaluator.summary.referenceUnresolved} irrelevant=${result.evaluator.summary.irrelevant}`,
    `[candidates] created=${result.candidates?.created ?? 0} existing=${result.candidates?.existing ?? 0} suppressed=${result.candidates?.suppressed ?? 0}`,
    `[notifier] sent=${result.notifier?.sent ?? 0} duplicate=${result.notifier?.duplicate ?? 0} failed=${result.notifier?.failed ?? 0}`,
  ];

  for (const item of result.evaluator.track) {
    const identity = [item.brand, item.model].filter(Boolean).join(" ");
    lines.push(
      `TRACK ${identity || item.title} ${formatKrw(item.askingPriceKrw)} / ${formatKrw(item.referenceNewPriceKrw)} = ${item.ratioPct.toFixed(2)}% | ${item.title} | ${item.url}`,
    );
  }

  return lines;
}
