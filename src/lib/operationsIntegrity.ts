import { isPaidOnlyProvenance } from "./paidOnly";
import { toBookmakerSelection } from "./odds";
import { ODDS_NEAR_KICKOFF_WINDOW_MS } from "./oddsCadence";
import {
  freshness,
  publicationStatusProblem,
  type Finding,
  type FixtureState,
} from "./predictionOperations";

// Earliest master introduction of Sprint 04 atomic snapshots (PR #178).
// Diagnostic applicability only: publishing still always requires valid evidence.
export const ATOMIC_EVIDENCE_INTRODUCED = new Date("2026-11-13T21:02:29Z");
export function requiresAtomicEvidence(
  provenance: string | null,
  publishedAt: Date | null,
) {
  return (
    isPaidOnlyProvenance(provenance) &&
    !(
      publishedAt &&
      Number.isFinite(+publishedAt) &&
      publishedAt < ATOMIC_EVIDENCE_INTRODUCED
    )
  );
}

/** Assess mutable display cache separately from immutable publication evidence.
 * No provider calls, no publication admission decision, no recovery execution.
 */
export function assessOperationalOdds(input: {
  status: string;
  kickoff: Date | null;
  marketType: string;
  selection: unknown;
  fixture?: FixtureState;
  now: Date;
  maxMinutes: number;
  cache?: {
    fetchedAt: Date | null;
    lastError: string | null;
    oddsJson: unknown;
  };
}) {
  const { cache, now, maxMinutes } = input;
  const local = freshness({
    fetchedAt: cache?.fetchedAt ?? null,
    lastError: cache?.lastError,
    now,
    maxMinutes,
  });
  const raw = cache?.oddsJson as
    | { update?: string; markets?: Array<{ market: string }> }
    | undefined;
  const provider = freshness({
    fetchedAt: raw?.update ? new Date(raw.update) : null,
    now,
    maxMinutes,
  });
  const state =
    local.status === "FRESH" || local.status === "AGING" ? provider : local;
  const mapped = toBookmakerSelection(input.marketType, input.selection);
  const finding = (
    code: string,
    severity: Finding["severity"],
    detail: string,
    repair: Finding["repair"] = null,
  ) => ({ code, severity, detail, repair });
  let issue: Omit<Finding, "predictionId" | "period"> | null = null;
  if (input.status !== "PUBLISHED" || !input.kickoff || input.kickoff <= now)
    return { state, local, provider, issue };
  if (publicationStatusProblem(input.fixture ?? null, input.kickoff, now))
    issue = finding(
      "ODDS_FIXTURE_STATUS_REVIEW",
      "INFO",
      "Stored fixture state or schedule is inconsistent with an upcoming quote refresh; verify scheduling first.",
    );
  else if (!mapped)
    issue = finding(
      "ODDS_MARKET_UNSUPPORTED",
      "INFO",
      "This market has no mapping in the stored bookmaker cache; refreshing cannot supply this market.",
    );
  else if (
    local.status === "PROVIDER_UNAVAILABLE" ||
    local.status === "UNKNOWN"
  )
    issue = finding(
      "ODDS_" + local.status,
      "WARNING",
      "Cache refresh failed or its result is unverified.",
      "MANUAL_REVIEW",
    );
  else if (cache?.lastError && local.status === "MISSING")
    issue = finding(
      "ODDS_COVERAGE_UNAVAILABLE",
      "INFO",
      "The last recorded provider response contained no quotes; current availability is unverified.",
    );
  else if (
    input.kickoff.getTime() - now.getTime() > ODDS_NEAR_KICKOFF_WINDOW_MS &&
    (local.status === "STALE" || local.status === "AGING") &&
    provider.status !== "UNKNOWN"
  )
    issue = finding(
      "ODDS_DISTANT_CACHE_RETAINED",
      "INFO",
      "Existing refresh policy fetches a distant fixture once successfully, then refreshes inside 24 hours of kickoff. Cached quote age alone does not require another call.",
    );
  else if (
    local.status === "STALE" ||
    local.status === "MISSING" ||
    local.status === "AGING"
  )
    issue = finding(
      "ODDS_REFRESH_DUE",
      "WARNING",
      "Supported upcoming market cache is missing or due for refresh; publication evidence remains frozen.",
      "REFRESH_ODDS",
    );
  else if (
    !Array.isArray(raw?.markets) ||
    !raw.markets.some((m) => m.market === mapped.market)
  )
    issue = finding(
      "ODDS_COVERAGE_UNAVAILABLE",
      "INFO",
      "The latest cached response does not cover this market; current provider availability is unverified.",
    );
  else if (provider.status === "UNKNOWN")
    issue = finding(
      "ODDS_PROVIDER_TIMESTAMP_UNVERIFIED",
      "WARNING",
      "Provider timestamp is invalid or in the future; freshness requires manual review.",
      "MANUAL_REVIEW",
    );
  else if (provider.status !== "FRESH")
    issue = finding(
      "ODDS_PROVIDER_TIMESTAMP_AGING",
      "INFO",
      "Recent local fetch contains aging or unavailable provider timestamps; another fetch may return the same quotes.",
    );
  return { state, local, provider, issue };
}
