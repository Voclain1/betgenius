/**
 * Presentation of Match Insights as "trend cards": the badge, the sentence and
 * the matching bet. Pure, so every wording and every market mapping is
 * checkable without a database (scripts/check-trend-cards.ts).
 */
import type { InsightEvidence, InsightType } from "@/lib/insights";
import { MIN_BOOKMAKERS, findSelection, type FixtureOdds, type TrimmedMarket } from "@/lib/odds";
import { lagosDateKey, lagosDayBounds } from "@/lib/lagosDate";

export type TrendTone = "positive" | "negative" | "goals";
export type SentencePart = { text: string; strong?: boolean; figure?: boolean };

export const TREND_PERIODS = ["today", "tomorrow", "weekend"] as const;
export type TrendPeriod = (typeof TREND_PERIODS)[number];
export const TREND_PERIOD_LABELS: Record<TrendPeriod, string> = { today: "Today", tomorrow: "Tomorrow", weekend: "Weekend" };
export const TREND_PERIOD_POSSESSIVE: Record<TrendPeriod, string> = { today: "today's", tomorrow: "tomorrow's", weekend: "this weekend's" };

/** Kickoff as the panel shows it, in Lagos time: "15/09/2026 19:00". */
export function trendKickoffLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(",", "");
}

export function isTrendPeriod(value: unknown): value is TrendPeriod {
  return typeof value === "string" && (TREND_PERIODS as readonly string[]).includes(value);
}

/**
 * Lagos calendar bounds. The weekend is Saturday and Sunday: the coming one,
 * or the current one while it is still under way.
 */
export function periodBounds(period: TrendPeriod, now: Date = new Date()): { start: Date; end: Date } {
  if (period === "today") return lagosDayBounds(0, now);
  if (period === "tomorrow") return lagosDayBounds(1, now);
  const weekday = new Date(`${lagosDateKey(now)}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  const toSaturday = weekday === 6 ? 0 : weekday === 0 ? -1 : 6 - weekday;
  const start = lagosDayBounds(toSaturday, now).start;
  return { start, end: new Date(start.getTime() + 2 * 24 * 60 * 60_000) };
}

const TONES: Record<InsightType, TrendTone> = {
  WIN_STREAK: "positive",
  UNBEATEN_STREAK: "positive",
  SCORED_2: "positive",
  CLEAN_SHEET: "positive",
  LOSS_STREAK: "negative",
  WINLESS_STREAK: "negative",
  FAILED_TO_SCORE: "negative",
  OVER_25: "goals",
  BTTS: "goals",
};

const STREAK_TITLES: Partial<Record<InsightType, string>> = {
  WIN_STREAK: "Won",
  UNBEATEN_STREAK: "Unbeaten",
  LOSS_STREAK: "Lost",
  WINLESS_STREAK: "Winless",
};

const FREQUENCY_TITLES: Partial<Record<InsightType, string>> = {
  OVER_25: "Over 2.5",
  BTTS: "BTTS",
  SCORED_2: "Scored 2+",
  CLEAN_SHEET: "Clean sheet",
  FAILED_TO_SCORE: "No goal",
};

export function isStreak(type: InsightType) {
  return type in STREAK_TITLES;
}

/** The coloured tile under the crest, e.g. "Unbeaten 21" or "Over 2.5 · 8 of 10". */
export function trendBadge(e: Pick<InsightEvidence, "type" | "count" | "sampleSize" | "exact">): { title: string; figure: string; tone: TrendTone } {
  const tone = TONES[e.type];
  if (isStreak(e.type)) return { title: STREAK_TITLES[e.type]!, figure: e.exact ? String(e.count) : `${e.count}+`, tone };
  return { title: FREQUENCY_TITLES[e.type]!, figure: `${e.count} of ${e.sampleSize}`, tone };
}

function scopeNoun(e: Pick<InsightEvidence, "scope" | "leagueName">) {
  if (e.scope === "HOME") return "home matches";
  if (e.scope === "AWAY") return "away matches";
  if (e.scope === "COMPETITION" && e.leagueName) return `${e.leagueName} matches`;
  return "matches";
}

/** The headline sentence, split so the verb and every number can be emphasised. */
export function trendSentence(e: Pick<InsightEvidence, "type" | "count" | "sampleSize" | "exact" | "scope" | "leagueName" | "teamName">): SentencePart[] {
  const team: SentencePart = { text: e.teamName };
  const noun = scopeNoun(e);
  const n: SentencePart = { text: String(e.count), figure: true };
  const atLeast: SentencePart[] = e.exact ? [] : [{ text: "at least " }];
  const ofLast = (lead: SentencePart[]): SentencePart[] => [
    ...lead,
    { text: " in " }, n, { text: " of " },
  ];
  const tail = (possessive: string): SentencePart[] => [{ text: `${possessive} last ` }, { text: String(e.sampleSize), figure: true }, { text: ` ${noun}` }];

  switch (e.type) {
    case "WIN_STREAK":
      return [team, { text: " have " }, { text: "won", strong: true }, { text: " " }, ...atLeast, n, { text: ` ${noun} in a row` }];
    case "LOSS_STREAK":
      return [team, { text: " have " }, { text: "lost", strong: true }, { text: " " }, ...atLeast, n, { text: ` ${noun} in a row` }];
    case "UNBEATEN_STREAK":
      return [team, { text: " are " }, { text: "unbeaten", strong: true }, { text: " in " }, ...atLeast, n, { text: ` consecutive ${noun}` }];
    case "WINLESS_STREAK":
      return [team, { text: " are " }, { text: "without a win", strong: true }, { text: " in " }, ...atLeast, n, { text: ` consecutive ${noun}` }];
    case "OVER_25":
      return [...ofLast([{ text: "Over 2.5 goals", strong: true }, { text: " were scored" }]), ...tail(possessive(e.teamName))];
    case "BTTS":
      return [...ofLast([{ text: "Both teams scored", strong: true }]), ...tail(possessive(e.teamName))];
    case "SCORED_2":
      return [...ofLast([team, { text: " " }, { text: "scored 2+ goals", strong: true }]), ...tail("their")];
    case "CLEAN_SHEET":
      return [...ofLast([team, { text: " " }, { text: "kept a clean sheet", strong: true }]), ...tail("their")];
    case "FAILED_TO_SCORE":
      return [...ofLast([team, { text: " " }, { text: "failed to score", strong: true }]), ...tail("their")];
  }
}

/** "Arsenal's", but "Stade Rennais'". */
function possessive(name: string) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export function sentenceText(parts: SentencePart[]) {
  return parts.map((p) => p.text).join("");
}

/**
 * The bet a trend literally describes, as the bookmaker feed labels it.
 * `venue` is the trend team's side in the upcoming fixture.
 *
 * Deliberately literal rather than inferred: "unbeaten" is the team or the
 * draw, not the team to win; a winless run is the opponent or the draw.
 */
export function trendSelection(type: InsightType, venue: "HOME" | "AWAY"): { market: TrimmedMarket; value: string } {
  const side = venue === "HOME" ? "Home" : "Away";
  const other = venue === "HOME" ? "Away" : "Home";
  const orDraw = (s: string) => (s === "Home" ? "Home/Draw" : "Draw/Away");
  switch (type) {
    case "WIN_STREAK": return { market: "Match Winner", value: side };
    case "UNBEATEN_STREAK": return { market: "Double Chance", value: orDraw(side) };
    case "LOSS_STREAK": return { market: "Match Winner", value: other };
    case "WINLESS_STREAK": return { market: "Double Chance", value: orDraw(other) };
    case "OVER_25": return { market: "Goals Over/Under", value: "Over 2.5" };
    case "SCORED_2": return { market: "Goals Over/Under", value: "Over 1.5" };
    case "BTTS": return { market: "Both Teams Score", value: "Yes" };
    case "CLEAN_SHEET":
    case "FAILED_TO_SCORE": return { market: "Both Teams Score", value: "No" };
  }
}

export function selectionLabel(selection: { market: TrimmedMarket; value: string }, home: string, away: string) {
  const team = (s: string) => (s === "Home" ? home : away);
  if (selection.market === "Match Winner") return selection.value === "Draw" ? "Draw" : team(selection.value);
  if (selection.market === "Double Chance") return `${team(selection.value === "Home/Draw" ? "Home" : "Away")} or draw`;
  if (selection.market === "Both Teams Score") return `BTTS ${selection.value}`;
  return selection.value;
}

/** A price is only shown when enough books quote that exact selection to call it a market price. */
export function trendPrice(odds: FixtureOdds | null, type: InsightType, venue: "HOME" | "AWAY", home: string, away: string): { label: string; odds: number } | null {
  const selection = trendSelection(type, venue);
  const quoted = findSelection(odds, selection.market, selection.value);
  if (!quoted || quoted.bookmakers < MIN_BOOKMAKERS) return null;
  return { label: selectionLabel(selection, home, away), odds: quoted.best };
}

type Ranked = { predictionId: string; strength: number; evidence: Pick<InsightEvidence, "type" | "exact" | "count" | "sampleSize"> };

/** Orders by strength, then longer proven streaks, then larger samples. */
export function compareTrends(a: Ranked, b: Ranked) {
  return b.strength - a.strength
    || Number(b.evidence.exact) - Number(a.evidence.exact)
    || b.evidence.count - a.evidence.count
    || b.evidence.sampleSize - a.evidence.sampleSize;
}

/** The strongest trend per fixture, so one match cannot fill the panel. */
export function topPerFixture<T extends Ranked>(rows: T[], limit: number): T[] {
  const best = new Map<string, T>();
  for (const row of [...rows].sort(compareTrends)) if (!best.has(row.predictionId)) best.set(row.predictionId, row);
  return [...best.values()].slice(0, limit);
}
