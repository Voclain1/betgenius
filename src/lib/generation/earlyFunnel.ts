/**
 * Pure helpers for the early-engine funnel audit (scripts/audit-early-engine-funnel.ts).
 * Kept in src so they are unit-checked without importing the audit script.
 */
/** The audit's kickoff-distance groups (whole days before kickoff at capture). */
export const BANDS = [
  { id: "A", label: "0–24 hours", minH: 0, maxH: 24 },
  { id: "B", label: "1–3 days", minH: 24, maxH: 96 },
  { id: "C", label: "4–7 days", minH: 96, maxH: 192 },
  { id: "D", label: "8–14 days", minH: 192, maxH: 360 },
  { id: "E", label: "more than 14 days", minH: 360, maxH: Infinity },
] as const;
export function bandOf(leadHours: number): string {
  return (BANDS.find(b => leadHours >= b.minH && leadHours < b.maxH) ?? BANDS[0]).id;
}

/** Reason codes for a ledger row's lastError, without echoing provider text. */
export function attemptErrorClass(lastError: string | null): string {
  if (!lastError) return "none";
  if (/^Evidence pending/.test(lastError) || /No usable results/.test(lastError)) return "no-usable-evidence";
  if (/^Early deferred/.test(lastError)) return "early-deferred-selective";
  if (/^Provider outage/.test(lastError)) return "model-provider-outage";
  if (/league name/.test(lastError)) return "league-name-unresolved";
  if (/CACHE_ONLY_FOOTBALL_API_CALL_BLOCKED/.test(lastError)) return "cache-only-call-blocked";
  if (/Unsupported claim/.test(lastError)) return "unsupported-claim";
  if (/odds|price/i.test(lastError)) return "odds-or-price";
  return "other";
}

