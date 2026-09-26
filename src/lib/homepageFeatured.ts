import { leaguePriorityRank } from "@/lib/leagues";
import { isValidSelection, type MarketType, type Selection } from "@/lib/markets";
import { checkLegCompatibility } from "@/lib/sameGameDouble";
import type { FeedDay } from "@/lib/categoryPredictions";

/**
 * Which six FEATURED picks the homepage excerpt shows for a Lagos day.
 *
 * HOMEPAGE ONLY. /predictions/featured, /predictions/combo-bets and every
 * league/team/archive page keep orderForDisplay (src/lib/predictionOrdering.ts).
 * Nothing here changes what the FEATURED tag means; it decides which six of
 * the tagged rows the homepage shows.
 *
 * WHY IT IS NOT orderForDisplay. That comparator sorts settled rows after
 * pending ones and settled rows among themselves by kickoff. Right for an
 * archive, wrong for a capped excerpt: once results arrived, a day's six
 * slots were re-picked by kickoff time, so Yesterday's Featured showed a
 * different six from the ones on the page that morning. The set rewrote
 * itself after the outcomes were known. In production on 2026-09-19 that
 * gave all six slots to combos while 102 single-market FEATURED picks existed.
 *
 * OUTCOME-BLIND BY CONSTRUCTION. Selection reads only fields fixed before
 * kickoff: confidence, competition, publishedAt, id, market type and the
 * combo's legs. It never reads outcome, settledAt or manualSettlementOnly
 * (settlement flips that flag when a fixture is abandoned or a leg goes
 * missing), and not kickoff either, because settlement rewrites kickoff when
 * the provider reports a reschedule. The result chips still update from
 * PENDING to WON/LOST. Only which rows fill the slots, and in what order,
 * stays fixed. See scripts/check-homepage-featured.ts.
 *
 * COMBOS ARE A FALLBACK. Single-market picks fill every slot they can. A
 * SAME_GAME_DOUBLE is considered only when fewer than six singles exist, and
 * only if it is exceptional (isExceptionalHomepageCombo). The excerpt is never
 * padded past that: a day with three eligible picks shows three.
 *
 * GENIUS uses the same outcome-blind ranking for its three-row excerpt
 * (selectHomepageGenius) and is a deliberate showcase: three different
 * matches, and no Over/Under 2.5 call, whether a plain O/U 2.5 pick or a combo
 * with an O/U 2.5 leg. It has no confidence bar of its own; curation already
 * decided what is GENIUS. /predictions/genius lists every GENIUS pick as before.
 */

export const HOMEPAGE_FEATURED_LIMIT = 6;
export const HOMEPAGE_GENIUS_LIMIT = 3;

/**
 * The confidence a combo, and each of its legs, must reach to take a homepage
 * Featured slot.
 *
 * A combo's confidence is the ceiling min(legA, legB) (comboConfidenceCeiling),
 * so 80 means BOTH legs are at 80 or above, the band where single FEATURED
 * picks strike 86% (104W/17L). Measured on the 568 published FEATURED combos
 * as of 2026-09-25: none reach 85, and 12 (2.1%) reach 80, spread over 8 days
 * with a 7W/3L record. Below that, combos settle at 52-55% (75-79: 27W/23L;
 * 70-74: 89W/81L). At 78, 25 combos (4.4%) would qualify. At 82, only 4.
 *
 * Deliberately NOT gated on MARKET_CONFIRMED or on priced legs: as of that
 * date no combo leg carries MARKET_CONFIRMED and none carries odds, because
 * that pass no longer runs and doubles are never priced (marketConfirmed.ts
 * excludes them). Requiring either would bar every combo permanently.
 */
export const HOMEPAGE_COMBO_MIN_CONFIDENCE = 80;

/** Leg statuses a double may be built from. Same set as sameGameDoubleAssembly's LEG_STATUSES. */
const LEG_STATUSES = ["APPROVED", "PUBLISHED"];

export type HomepageFeaturedCandidate = {
  id: string;
  marketType: string;
  confidence: number | null;
  leagueApiId?: number | null;
  publishedAt?: Date | string | null;
  selection?: unknown;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
  fixtureApiId?: number | null;
};

/** What the page loads for each leg a combo references. Pre-match fields only. */
export type HomepageComboLeg = {
  id: string;
  status: string;
  marketType: string;
  selection: unknown;
  confidence: number;
  contextComplete: boolean;
  homeTeamApiId: number | null;
  awayTeamApiId: number | null;
};

export const isComboRow = (row: { marketType: string }): boolean => row.marketType === "SAME_GAME_DOUBLE";

/** The two leg ids a combo row references, or null when its selection is unreadable. */
export function comboLegIds(row: HomepageFeaturedCandidate): [string, string] | null {
  if (!isComboRow(row) || !isValidSelection("SAME_GAME_DOUBLE", row.selection)) return null;
  return (row.selection as { legIds: [string, string] }).legIds;
}

const time = (value: Date | string | null | undefined): number => {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
};

/**
 * Homepage excerpt ranking (Featured and Genius): confidence, then
 * competition priority, then earliest published, then id.
 *
 * Total: id is always the final tiebreak, so the same rows give the same order
 * whatever order the database returns them in.
 */
export function compareForHomepageExcerpt(a: HomepageFeaturedCandidate, b: HomepageFeaturedCandidate): number {
  return (
    (b.confidence ?? 0) - (a.confidence ?? 0) ||
    leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
    time(a.publishedAt) - time(b.publishedAt) ||
    a.id.localeCompare(b.id)
  );
}

function legQualifies(combo: HomepageFeaturedCandidate, leg: HomepageComboLeg | undefined): leg is HomepageComboLeg {
  return (
    !!leg &&
    LEG_STATUSES.includes(leg.status) &&
    // A double is never a leg of a double, and OTHER is the free-text market
    // with no structured selection to settle against.
    leg.marketType !== "SAME_GAME_DOUBLE" &&
    leg.marketType !== "OTHER" &&
    isValidSelection(leg.marketType as MarketType, leg.selection) &&
    // Generated with live match data, not from the model's priors alone.
    leg.contextComplete &&
    leg.confidence >= HOMEPAGE_COMBO_MIN_CONFIDENCE &&
    // The leg is about the combo's own fixture.
    leg.homeTeamApiId != null &&
    leg.homeTeamApiId === combo.homeTeamApiId &&
    leg.awayTeamApiId === combo.awayTeamApiId
  );
}

/**
 * May this combo take a homepage Featured slot left empty by singles?
 *
 * Its confidence reaches HOMEPAGE_COMBO_MIN_CONFIDENCE, both referenced legs
 * exist, and each leg passes the checks a double is assembled under: an
 * approved or published row on this fixture, a structured non-OTHER market
 * with a valid selection, generated with live context, and at least as
 * confident as the threshold. The two legs must also still be a compatible
 * pair (neither REDUNDANT nor CONTRADICTORY).
 */
export function isExceptionalHomepageCombo(
  combo: HomepageFeaturedCandidate,
  legsById: ReadonlyMap<string, HomepageComboLeg>,
): boolean {
  if ((combo.confidence ?? 0) < HOMEPAGE_COMBO_MIN_CONFIDENCE) return false;
  const ids = comboLegIds(combo);
  if (!ids) return false;
  const [a, b] = ids.map((id) => legsById.get(id));
  if (!legQualifies(combo, a) || !legQualifies(combo, b)) return false;
  return checkLegCompatibility(
    { marketType: a.marketType as MarketType, selection: a.selection as Selection },
    { marketType: b.marketType as MarketType, selection: b.selection as Selection },
  ).ok;
}

/**
 * The homepage Featured excerpt: the best singles first, then exceptional
 * combos in whatever slots remain.
 *
 * `legsById` only has to cover the combos in `rows`; when six singles exist it
 * is never read, so the caller may pass an empty map.
 */
export function selectHomepageFeatured<T extends HomepageFeaturedCandidate>(
  rows: readonly T[],
  legsById: ReadonlyMap<string, HomepageComboLeg>,
  limit: number = HOMEPAGE_FEATURED_LIMIT,
): T[] {
  const singles = rows.filter((r) => !isComboRow(r)).sort(compareForHomepageExcerpt).slice(0, limit);
  if (singles.length >= limit) return singles;
  const combos = rows
    .filter((r) => isComboRow(r) && isExceptionalHomepageCombo(r, legsById))
    .sort(compareForHomepageExcerpt)
    .slice(0, limit - singles.length);
  return [...singles, ...combos];
}

/** A structured Over/Under 2.5 total-goals call: marketType OVER_UNDER on the 2.5 line. */
const isOverUnder25 = (marketType: string, selection: unknown): boolean =>
  marketType === "OVER_UNDER" &&
  isValidSelection("OVER_UNDER", selection) &&
  (selection as { line: number }).line === 2.5;

/**
 * May this GENIUS row appear in the homepage showcase?
 *
 * Read from the structured market, never from the display text. A plain pick
 * is out when it is itself O/U 2.5. A combo is out when either leg is, and
 * also when its legs cannot be read: without them there is no way to show it
 * holds no O/U 2.5 leg, so it fails closed. Team goals (TEAM_TOTAL) and other
 * total-goals lines are not O/U 2.5 and stay eligible. The legacy
 * ouLine/ouDirection fields every row carries are side information, not the
 * pick, so they are not read.
 */
export function isHomepageGeniusEligible(
  row: HomepageFeaturedCandidate,
  legsById: ReadonlyMap<string, Pick<HomepageComboLeg, "marketType" | "selection">>,
): boolean {
  if (!isComboRow(row)) return !isOverUnder25(row.marketType, row.selection);
  const ids = comboLegIds(row);
  if (!ids) return false;
  const legs = ids.map((id) => legsById.get(id));
  return legs.every((leg) => !!leg && !isOverUnder25(leg.marketType, leg.selection));
}

/**
 * The match a row is about, for the one-pick-per-fixture rule.
 *
 * The provider fixture id when the row has one, else the team pair; the
 * excerpt covers a single Lagos day, so a team pair is one match. Kickoff is
 * deliberately not part of it: settlement rewrites kickoff on a reschedule. A
 * row with neither falls back to its own id and is never merged with another.
 */
function homepageFixtureKey(row: HomepageFeaturedCandidate): string {
  if (row.fixtureApiId != null) return `fx:${row.fixtureApiId}`;
  if (row.homeTeamApiId != null && row.awayTeamApiId != null) return `teams:${row.homeTeamApiId}-${row.awayTeamApiId}`;
  return `row:${row.id}`;
}

/**
 * The homepage Genius excerpt: walk the day's GENIUS picks from strongest to
 * weakest by the outcome-blind ranking, skip ineligible ones and any match
 * already shown, and stop at three.
 *
 * `legsById` has to cover the legs of every combo in `rows`; a combo whose
 * legs are missing is skipped.
 */
export function selectHomepageGenius<T extends HomepageFeaturedCandidate>(
  rows: readonly T[],
  legsById: ReadonlyMap<string, Pick<HomepageComboLeg, "marketType" | "selection">>,
  limit: number = HOMEPAGE_GENIUS_LIMIT,
): T[] {
  const picked: T[] = [];
  const fixtures = new Set<string>();
  for (const row of [...rows].sort(compareForHomepageExcerpt)) {
    if (picked.length >= limit) break;
    if (!isHomepageGeniusEligible(row, legsById)) continue;
    const fixture = homepageFixtureKey(row);
    if (fixtures.has(fixture)) continue;
    fixtures.add(fixture);
    picked.push(row);
  }
  return picked;
}

/**
 * Shown when the day has FEATURED picks but none are eligible for the
 * homepage excerpt. Reader-facing, so it names no threshold or rule.
 */
export function featuredBarMessage(day: FeedDay): string {
  if (day === "yesterday") return "No Featured picks met yesterday's homepage quality bar.";
  return `No Featured picks meet ${day === "tomorrow" ? "tomorrow's" : "today's"} homepage quality bar yet.`;
}
