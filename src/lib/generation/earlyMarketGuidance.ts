/**
 * Real quoted market availability for the early FREE analysis prompt.
 * No model confidence is derived from prices and no bookmaker quote here
 * grants publication authority; the atomic publisher rechecks exact prices.
 */
import type { FixtureOdds } from "@/lib/odds";
import { HEADLINE_MARKETS } from "@/lib/odds";
import { AUTO_MIN_MEDIAN_ODDS } from "@/lib/autoOddsFloor";
import { earlyOddsBand } from "@/lib/generation/earlyOddsPolicy";

const ALLOWED = new Set<string>(HEADLINE_MARKETS);

export function earlyMarketGuidance(
  odds: FixtureOdds | null,
  kickoff: Date,
  now: Date,
): string[] {
  if (!odds?.update || !Array.isArray(odds.markets)) return [];
  const stamp = new Date(odds.update);
  const lead = kickoff.getTime() - now.getTime();
  const maxLead = 14 * 24 * 3_600_000;
  if (!Number.isFinite(stamp.getTime()) || stamp > now || stamp > kickoff ||
      lead <= 48 * 3_600_000 || lead > maxLead) return [];
  const band = earlyOddsBand(kickoff, now);
  if (now.getTime() - stamp.getTime() > band.maxQuoteAgeMs) return [];
  const found:string[] = [];
  for (const market of odds.markets) {
    if (!ALLOWED.has(market.market)) continue;
    for(const sel of market.selections) {
      if (sel.bookmakers < band.minBooks || !Number.isFinite(sel.median) ||
        sel.median < AUTO_MIN_MEDIAN_ODDS ||
        !Number.isFinite(sel.best) || sel.best <= 1) continue;
      // Bookmaker coverage is context; the model must not infer statistical
      // certainty from it. The exact price is verified again at publication.
      found.push(`${market.market}: ${sel.value} (${sel.bookmakers} quoting bookmakers)`);
    }
  }
  return found.slice(0, 30);
}
