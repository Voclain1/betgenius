/**
 * The one-paragraph answer that sits directly under a page's H1.
 *
 * Written for the reader who is skimming and for the engine that is looking
 * for a sentence to quote: what this page holds, in plain prose, before any
 * card, table or filter. Every figure comes from data the page has already
 * loaded — nothing here is generated, and nothing is hardcoded, so the
 * sentence moves with the corpus rather than going stale beside it.
 *
 * Pure string builders, no I/O and no JSX, so each one can be read at a glance
 * against the numbers its page renders below (see AnswerSummary.tsx for the
 * shared paragraph they render into).
 *
 * Two rules hold across all of them:
 *   - a win rate is quoted only above the sample gate the RateCard on the same
 *     page enforces, so the sentence and the card can never disagree;
 *   - no certainty language, ever (src/lib/certaintyLanguage.ts) — these are
 *     the most quotable sentences on the site, which makes them the worst
 *     place to overclaim.
 */

import { MIN_SETTLED_SAMPLE_SIZE, type WinRateStat } from "@/lib/trackRecord";
import { SITE_NAME } from "@/lib/seo";
import type { FeedDay } from "@/lib/categoryPredictions";

const count = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

/** "the Premier League, Serie A and Ligue 1" — an Oxford-comma-free list for prose. */
function nameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "a 61% win rate from 38 settled picks", or null when the sample is too small
 * to publish — the same MIN_SETTLED_SAMPLE_SIZE gate, on the same `decided`
 * denominator, that RateCard applies to the identical stat object.
 */
export function settledRatePhrase(stat: WinRateStat, noun = "picks"): string | null {
  if (stat.decided < MIN_SETTLED_SAMPLE_SIZE || stat.rate == null) return null;
  return `a ${Math.round(stat.rate * 100)}% win rate from ${count(stat.decided, `settled ${noun.replace(/s$/, "")}`, `settled ${noun}`)}`;
}

/** How far off the publishing gate a scope still is — the honest alternative to a rate on four picks. */
function belowGatePhrase(stat: WinRateStat): string {
  return `We publish a win rate once ${MIN_SETTLED_SAMPLE_SIZE} picks have settled in a scope this narrow — ${stat.decided} ${stat.decided === 1 ? "has" : "have"} so far`;
}

const DAY_WORD: Record<FeedDay, string> = { yesterday: "yesterday", today: "today", tomorrow: "tomorrow" };

/**
 * Homepage.
 *
 * Deliberately no percentage. A site-wide rate quoted here would be a second
 * copy of a number /track-record already owns, free to drift out of step with
 * it — which is exactly why the hero's win-rate stat was removed. This answers
 * "what is on this site right now" with counts and competitions instead, and
 * points at the page that does own the record.
 */
export function homeSummary(input: { day: FeedDay; pickCount: number; leagueCount: number; topLeagues: string[] }): string {
  const when = input.day === "today" ? "for today" : input.day === "tomorrow" ? "for tomorrow" : "for yesterday";

  if (input.pickCount === 0) {
    return `No football predictions are published ${when} yet — each day's card goes up once its fixtures and team data are in. Every pick we have settled stays published, win or lose, on our track record.`;
  }

  const across = input.leagueCount > 0 ? ` across ${count(input.leagueCount, "competition")}` : "";
  // "X, Y and Z among them" rather than "led by X, Y and Z": league names
  // differ on whether they take an article ("the Championship", but "Coppa
  // Italia"), and this construction reads correctly for both. Only headline
  // competitions are named at all — when none of the day's leagues is one, the
  // clause is simply absent rather than naming a third-tier cup tie.
  const led = input.topLeagues.length > 0 ? ` — ${nameList(input.topLeagues)} among them` : "";
  // The second sentence stays out of the way of the hero's own tagline
  // directly beneath it, which already says what a pick carries.
  return `${SITE_NAME} has ${count(input.pickCount, "football prediction")} published ${when}${across}${led}. Every settled result — win or lose — is published on our track record.`;
}

/**
 * Category feed. `blurb` is the same one-line description the /predictions
 * index shows for this category (CATEGORY_BLURBS), so the two surfaces
 * describe the feed identically rather than in two invented voices.
 */
export function categorySummary(input: { name: string; blurb: string; pickCount: number; day: FeedDay }): string {
  const when =
    input.day === "yesterday" ? "settled yesterday" : input.day === "tomorrow" ? "published for tomorrow" : "published for today";

  // "N picks in <name>" throughout, rather than bending the category name into
  // a plural — CATEGORY_NAMES holds "Banker" and "Bet of the Day" alongside
  // "Featured tips", and only one of those survives being counted directly.
  const blurb = `${input.blurb.charAt(0).toLowerCase()}${input.blurb.slice(1)}`;

  if (input.pickCount === 0) {
    const none =
      input.day === "yesterday"
        ? `No picks in ${input.name} settled yesterday`
        : `No picks in ${input.name} are published for ${DAY_WORD[input.day]} yet`;
    return `${none} — ${blurb}`;
  }

  return `${count(input.pickCount, "pick")} in ${input.name}, ${when} — ${blurb} Each carries a confidence rating and the reasoning behind it.`;
}

/** League page. The scoped record, stated as a sentence instead of left for the reader to assemble from the card below. */
export function leagueSummary(input: { name: string; pickCount: number; stat: WinRateStat }): string {
  const rate = settledRatePhrase(input.stat);
  const opener = `${SITE_NAME} has ${count(input.pickCount, "published prediction")} for ${input.name}`;
  return rate
    ? `${opener}, with ${rate} in this competition. Each pick names its market, its confidence rating and the reasoning behind it.`
    : `${opener}. ${belowGatePhrase(input.stat)}, so no rate is claimed for this competition yet.`;
}

/** Team page. Answers "what is this site's record predicting <team>'s matches" in one sentence. */
export function teamSummary(input: { name: string; pickCount: number; stat: WinRateStat }): string {
  const rate = settledRatePhrase(input.stat);
  const opener = `${SITE_NAME} has ${count(input.pickCount, "published prediction")} on ${input.name} matches`;
  return rate
    ? `${opener}, with ${rate} on this team. Each pick names its market, its confidence rating and the reasoning behind it.`
    : `${opener}. ${belowGatePhrase(input.stat)}, so no rate is claimed for this team yet.`;
}
