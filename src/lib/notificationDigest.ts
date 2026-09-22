import { generationTierOf, leaguePriorityRank, leaguesInTiers, type GenerationTier } from "@/lib/leagues";

/**
 * DIGEST-FIRST NOTIFICATION POLICY.
 *
 * Publication and settlement are individual events, and a busy day publishes
 * dozens of each. Pushing every one of them turns an opted-in reader's lock
 * screen into a feed, so the push channel is split in two:
 *
 *   IMMEDIATE    - a push is useful only if it arrives now: a kickoff reminder,
 *                  a material tip change, a withdrawal, a followed-match
 *                  insight, an explicitly selected top prediction.
 *   DIGEST-ONLY  - a push would only repeat what the day's digest says:
 *                  a new publication, a settled result. These still reach the
 *                  inbox with full per-match detail; they just do not ring.
 *
 * Two digests a Lagos day carry the digest-only content instead: a morning
 * one (categories ready, Bet of the Day, at most TOP_MATCH_HIGHLIGHT_MAX top
 * matches) and a night one (the day's settled record).
 *
 * Pure: no database, no React, so every rule here is asserted directly by
 * scripts/check-notification-digest.ts.
 */

export const DIGEST_MORNING = "DIGEST_MORNING";
export const DIGEST_NIGHT = "DIGEST_NIGHT";

export function isDigestEvent(type: string) {
  return type === DIGEST_MORNING || type === DIGEST_NIGHT;
}

/**
 * Types that are recorded in the inbox but never pushed on their own.
 * RESULT_* covers RESULT_WON / RESULT_LOST / RESULT_VOID and result corrections.
 */
export function isInboxOnlyType(type: string) {
  return type === "NEW_PREDICTION" || type.startsWith("RESULT_");
}

/** Whether a delivery of this type may interrupt someone with a push (still subject to quiet hours and pushEnabled). */
export function pushesImmediately(type: string) {
  return !isInboxOnlyType(type);
}

/** Literal rather than imported: notifications.ts imports this module. */
const TOP_PREDICTION = "TOP_PREDICTION";

/**
 * SECONDARY competitions strong enough to carry an interruptive top-prediction
 * push: established top flights, plus the NPFL, which is a headline competition
 * for this audience (MAJOR_LEAGUE_IDS). Other SECONDARY leagues and every
 * domestic cup in the tier are left out.
 */
export const TOP_PREDICTION_PUSH_SECONDARY: readonly number[] = [
  94, // Primeira Liga
  88, // Eredivisie
  144, // Belgian Pro League
  203, // Süper Lig
  307, // Saudi Pro League
  399, // NPFL
  // Women's: the WSL is the strongest SECONDARY women's league. Every other
  // senior women's competition can reach the inbox, and (if SECONDARY) the
  // morning-digest highlights, but never an interruptive push on tier alone.
  44, // Women's Super League
];

/**
 * Strong competitions held in a lower generation tier for DATA reasons, whose
 * top predictions may still push, but only when the prediction itself is
 * MARKET_CONFIRMED: it passed the site's normal odds-agreement gate
 * (marketConfirmed.ts), so it is priced and a second source agreed with the
 * model. That is the existing bar, applied as a requirement rather than
 * lowered: no threshold here is specific to these competitions.
 *
 * UWCL is FALLBACK only because the provider does not price it yet.
 */
export const TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY: readonly number[] = [
  525, // UEFA Women's Champions League
];

/** What a TOP_PREDICTION event carries about its prediction (NotificationEvent.data). */
export type TopPredictionEvidence = { marketConfirmed: boolean };

/** Read the evidence from an event's stored data. Missing or malformed data is not market-confirmed. */
export function topPredictionEvidence(data: unknown): TopPredictionEvidence {
  const d = (data ?? {}) as { provenance?: unknown; odds?: unknown };
  return { marketConfirmed: d.provenance === "MARKET_CONFIRMED" && typeof d.odds === "number" };
}

/**
 * Whether a TOP_PREDICTION in this competition may ring a device.
 *
 * CORE: yes. The selected SECONDARY leagues above: yes. The market-confirmed-
 * only list: only with a MARKET_CONFIRMED, priced prediction. Everything else,
 * including FALLBACK, DEEP_FALLBACK and an unknown league: no. The event and
 * its inbox entry are kept either way; this only governs the interruptive push.
 * Eligibility is not a guarantee: the editorial daily cap still limits how many
 * eligible ones actually push.
 */
export function topPredictionPushEligible(leagueApiId: number | null | undefined, evidence?: TopPredictionEvidence) {
  const tier = generationTierOf(leagueApiId);
  if (tier === "CORE" || (tier === "SECONDARY" && TOP_PREDICTION_PUSH_SECONDARY.includes(leagueApiId as number))) return true;
  return TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY.includes(leagueApiId as number) && evidence?.marketConfirmed === true;
}

/** Leagues whose top predictions may push on tier alone, for database filters. */
export function topPredictionPushLeagueIds(): number[] {
  return [...leaguesInTiers(["CORE"]), ...TOP_PREDICTION_PUSH_SECONDARY];
}

/**
 * An event that is recorded in the inbox but never pushed: an inbox-only type,
 * or a top prediction that is not push-eligible (see topPredictionPushEligible).
 */
export function isInboxOnlyEvent(event: { type: string; leagueApiId?: number | null; data?: unknown }) {
  if (isInboxOnlyType(event.type)) return true;
  return event.type === TOP_PREDICTION && !topPredictionPushEligible(event.leagueApiId, topPredictionEvidence(event.data));
}

/**
 * Which daily-cap allowance a delivery draws on. Decided by type and league
 * only (never the stored evidence), so it matches the database filter dispatch
 * counts with: a top prediction in a market-confirmed-only league always draws
 * on the push allowance, which is the conservative side.
 */
export function dailyCapClass(event: { type: string; leagueApiId?: number | null }): "inbox" | "push" {
  if (isInboxOnlyType(event.type)) return "inbox";
  if (event.type !== TOP_PREDICTION) return "push";
  const id = event.leagueApiId;
  return id != null && (topPredictionPushLeagueIds().includes(id) || TOP_PREDICTION_PUSH_MARKET_CONFIRMED_ONLY.includes(id)) ? "push" : "inbox";
}

export type TopPredictionDelivery = "push" | "inbox-only" | "capped";

/**
 * What dispatch does with one TOP_PREDICTION for one user.
 *
 *   inbox-only - not in an eligible competition: inbox entry, no push, and it
 *                does not use up the editorial cap.
 *   capped     - eligible, but the user has already had `cap` eligible top
 *                predictions today (the existing editorial-cap skip).
 *   push       - eligible and under the cap; still subject to pushEnabled and
 *                quiet hours.
 */
export function topPredictionDelivery(
  leagueApiId: number | null | undefined,
  eligibleToday: number,
  cap: number,
  evidence?: TopPredictionEvidence,
): TopPredictionDelivery {
  if (!topPredictionPushEligible(leagueApiId, evidence)) return "inbox-only";
  return eligibleToday >= Math.min(cap, INDIVIDUAL_TOP_PUSH_MAX) ? "capped" : "push";
}

/** At most this many individual matches are highlighted in a morning digest. */
export const TOP_MATCH_HIGHLIGHT_MAX = 3;

/**
 * Ceiling on individually pushed top predictions per user per day, whatever
 * EDITORIAL_DAILY_CAP is configured to. The policy is 1-3; an environment typo
 * cannot widen it.
 */
export const INDIVIDUAL_TOP_PUSH_MAX = 3;

/** Competition tiers whose fixtures may be highlighted. FALLBACK and DEEP_FALLBACK never are. */
export const HIGHLIGHT_TIERS: readonly GenerationTier[] = ["CORE", "SECONDARY"];

/**
 * Digest timing, as minutes after Lagos midnight. The scheduler is not assumed:
 * the reminders job runs every few minutes and creates each digest the first
 * time it runs inside the window, and the event key makes later runs no-ops.
 */
export const DIGEST_TIMING = {
  /**
   * Morning digest: never before 09:00. From 09:00 to 09:30 it waits unless the
   * slate already looks complete (MORNING_EARLY_MIN_READY)...
   */
  morningFrom: 9 * 60,
  /** ...from 09:30 any category content (or Bet of the Day) is enough... */
  morningSettle: 9 * 60 + 30,
  /** ...and from 10:00, the hard latest point, any usable pick at all. */
  morningHardLatest: 10 * 60,
  /** Last run that may still create it, for a slate published very late. */
  morningUntil: 13 * 60,
  /** A morning digest not delivered by 14:00 is dropped rather than sent stale. */
  morningExpires: 14 * 60,
  /**
   * Night digest is first evaluated at 23:00. It is created then, or on any
   * later reminders run, once the day's picks are all (or substantially,
   * NIGHT_SUBSTANTIAL_SETTLED_SHARE) settled; otherwise it defers...
   */
  nightFrom: 23 * 60,
  /**
   * ...until the hard cutoff at 23:55, when whatever has settled goes out as
   * "Results so far" with the unsettled count. Still the same Lagos day, so the
   * digest's day key is always the day it summarises; nothing is created after
   * midnight for the previous day.
   */
  nightDeadline: 23 * 60 + 55,
  /** Dropped if still undelivered at 06:00 the next morning. */
  nightExpiresNextDay: 6 * 60,
} as const;

export const DIGEST_TIMEZONE = "Africa/Lagos";
const LAGOS_OFFSET = "+01:00";

/** YYYY-MM-DD of `now` in Lagos. */
export function lagosDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DIGEST_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Minutes since Lagos midnight. */
export function lagosMinuteOfDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: DIGEST_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
}

/** The instant `minutes` after Lagos midnight on `day` (minutes may exceed 1440 to reach the next day). */
export function lagosInstant(day: string, minutes: number) {
  return new Date(new Date(`${day}T00:00:00${LAGOS_OFFSET}`).getTime() + minutes * 60_000);
}

export function morningDigestKey(day: string) {
  return `digest:morning:${day}`;
}

export function nightDigestKey(day: string) {
  return `digest:night:${day}`;
}

export type DigestPick = {
  id: string;
  homeTeam: string | null;
  awayTeam: string | null;
  leagueApiId: number | null;
  leagueName?: string | null;
  market: string;
  pick: string;
  odds: number | null;
  confidence: number;
  kickoff: Date | null;
  outcome: string;
  /** The row's primary category. */
  category: string;
  /** Category tags (PredictionCategoryLink). */
  categories: string[];
  /** Match page link, already built. */
  link: string;
  homeTeamApiId?: number | null;
  awayTeamApiId?: number | null;
};

/**
 * Before the cutoff, the night digest goes out once at least this share of the
 * day's picks has settled. Below 1 so that one postponed or slow-to-settle
 * fixture does not hold the whole day's summary to the cutoff; the digest then
 * still says how many are awaiting results.
 */
export const NIGHT_SUBSTANTIAL_SETTLED_SHARE = 0.9;

/** Categories announced in a morning digest, in the order they are named. Bet of the Day has its own line. */
export const DIGEST_CATEGORY_ORDER = ["BANKER", "GENIUS", "VIP", "PREMIUM", "SAME_GAME_DOUBLE"] as const;

const CATEGORY_LABEL: Record<string, string> = {
  BET_OF_THE_DAY: "Bet of the Day",
  BANKER: "Banker",
  GENIUS: "Genius",
  VIP: "VIP",
  PREMIUM: "Premium",
  SAME_GAME_DOUBLE: "Combo",
  FEATURED: "Featured",
  TODAY: "Today",
};

const CATEGORY_PATH: Record<string, string> = {
  BET_OF_THE_DAY: "/predictions/bet-of-the-day",
  BANKER: "/predictions/banker",
  GENIUS: "/predictions/genius",
  VIP: "/predictions/vip",
  PREMIUM: "/predictions/premium",
  SAME_GAME_DOUBLE: "/predictions/combo-bets",
};

/** Categories whose picks a paywall can hide. Used only to pick a link target; visibility itself is `canView`. */
const EDITORIAL_TAGS = new Set(["BANKER", "GENIUS", "VIP", "PREMIUM", "BET_OF_THE_DAY"]);

function tagsOf(p: Pick<DigestPick, "category" | "categories">) {
  return [...new Set([p.category, ...p.categories])];
}

function hasCategory(p: DigestPick, category: string) {
  return p.category === category || p.categories.includes(category);
}

/**
 * Whether the viewer may see this pick's selection. Every category the row
 * carries must be viewable, so a VIP row cross-posted into a free category is
 * still treated as VIP. Conservative on purpose: a lock screen is not an
 * entitlement check.
 */
export function pickVisible(p: Pick<DigestPick, "category" | "categories">, canView: (category: string) => boolean) {
  return tagsOf(p).every(canView);
}

function fixtureKey(p: DigestPick) {
  return `${p.homeTeam ?? "?"}|${p.awayTeam ?? "?"}|${p.kickoff?.toISOString() ?? p.id}`;
}

/**
 * The day's top matches: at most `max`, never from FALLBACK/DEEP_FALLBACK.
 *
 * Eligibility is not selection. Being in a CORE competition makes a pick a
 * candidate; the cap still applies however many CORE picks there are. Order:
 * CORE before SECONDARY (so SECONDARY only fills slots CORE leaves), then picks
 * with an editorial tag, then league priority, then confidence. A pick with no
 * price is skipped: without viable market data it is not a pick to lead with.
 * One pick per fixture.
 */
export function selectTopMatches(picks: DigestPick[], opts: { exclude?: Set<string>; max?: number } = {}) {
  const max = Math.max(0, Math.min(opts.max ?? TOP_MATCH_HIGHLIGHT_MAX, TOP_MATCH_HIGHLIGHT_MAX));
  const tierRank = (p: DigestPick) => HIGHLIGHT_TIERS.indexOf(generationTierOf(p.leagueApiId) as GenerationTier);
  const candidates = picks
    .filter((p) => p.outcome === "PENDING" && p.odds != null && !opts.exclude?.has(p.id) && tierRank(p) >= 0)
    .sort(
      (a, b) =>
        tierRank(a) - tierRank(b) ||
        Number(!tagsOf(a).some((t) => EDITORIAL_TAGS.has(t))) - Number(!tagsOf(b).some((t) => EDITORIAL_TAGS.has(t))) ||
        leaguePriorityRank(a.leagueApiId) - leaguePriorityRank(b.leagueApiId) ||
        b.confidence - a.confidence ||
        a.id.localeCompare(b.id),
    );
  const seen = new Set<string>();
  const out: DigestPick[] = [];
  for (const p of candidates) {
    if (out.length >= max) break;
    const key = fixtureKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

type DigestMatch = Pick<DigestPick, "id" | "homeTeam" | "awayTeam" | "market" | "pick" | "category" | "categories" | "link" | "leagueName">;

/**
 * One pick as a digest carries it, with exactly what a follow can match on.
 * Every usable (morning) or summarised (night) pick is kept on the event so a
 * follower-scoped digest can be rendered per recipient at dispatch.
 */
export type DigestItem = DigestMatch & { leagueApiId: number | null; teamApiIds: number[]; outcome: string };

export type MorningDigestData = {
  kind: "MORNING";
  day: string;
  categories: { category: string; count: number }[];
  betOfTheDay: DigestMatch | null;
  highlights: DigestMatch[];
  items: DigestItem[];
};

function asMatch(p: DigestPick): DigestMatch {
  return { id: p.id, homeTeam: p.homeTeam, awayTeam: p.awayTeam, market: p.market, pick: p.pick, category: p.category, categories: p.categories, link: p.link, leagueName: p.leagueName ?? null };
}

function asItem(p: DigestPick): DigestItem {
  return {
    ...asMatch(p),
    leagueApiId: p.leagueApiId,
    teamApiIds: [p.homeTeamApiId, p.awayTeamApiId].filter((x): x is number => x != null),
    outcome: p.outcome,
  };
}

/**
 * The morning digest from today's picks, or null when nothing is usable yet.
 * Usable = published (the caller's query), unsettled, and not yet kicked off.
 */
export function buildMorningDigest(picks: DigestPick[], betOfTheDayId: string | null, now: Date): MorningDigestData | null {
  const usable = picks.filter((p) => p.outcome === "PENDING" && p.kickoff != null && p.kickoff > now);
  if (!usable.length) return null;
  const botd = betOfTheDayId ? usable.find((p) => p.id === betOfTheDayId) ?? null : null;
  const categories = DIGEST_CATEGORY_ORDER.map((category) => ({ category, count: usable.filter((p) => hasCategory(p, category)).length })).filter((c) => c.count > 0);
  const highlights = selectTopMatches(usable, { exclude: new Set(botd ? [botd.id] : []) });
  return { kind: "MORNING", day: lagosDay(now), categories, betOfTheDay: botd ? asMatch(botd) : null, highlights: highlights.map(asMatch), items: usable.map(asItem) };
}

/**
 * Before 09:30, the morning digest needs at least this many ready "slots" (a
 * digest category with picks counts one, Bet of the Day counts one). Two means
 * one early category cannot freeze the day's digest on its own: the event is
 * immutable once created, so anything published after it would be left out.
 */
export const MORNING_EARLY_MIN_READY = 2;

export type MorningDecision = { send: true; reason: string } | { send: false; reason: string };

/**
 * Whether to create today's morning digest from `data` (the digest as it would
 * be built right now), given the time. Category readiness is the signal, not
 * merely "some pick exists":
 *
 *   before 09:00          never.
 *   09:00 to 09:30        only once 2+ slots are ready (two categories, or
 *                         Bet of the Day plus a category); otherwise wait.
 *   09:30 to 10:00        once any category (or Bet of the Day) is ready.
 *   10:00 (hard latest)   whatever valid picks exist, so a sparse day with a
 *                         single category, or none, still gets its digest.
 *   13:00 onwards         no longer created.
 */
export function morningDigestDecision(data: MorningDigestData | null, now: Date): MorningDecision {
  const minute = lagosMinuteOfDay(now);
  if (minute < DIGEST_TIMING.morningFrom) return { send: false, reason: "before 09:00" };
  if (minute >= DIGEST_TIMING.morningUntil) return { send: false, reason: "after the morning window" };
  if (!data) return { send: false, reason: "nothing usable yet" };
  const ready = data.categories.length + (data.betOfTheDay ? 1 : 0);
  if (minute >= DIGEST_TIMING.morningHardLatest) return { send: true, reason: "hard latest point" };
  if (minute >= DIGEST_TIMING.morningSettle) {
    return ready > 0 ? { send: true, reason: "category content ready" } : { send: false, reason: "waiting for category content" };
  }
  return ready >= MORNING_EARLY_MIN_READY
    ? { send: true, reason: `${ready} categories ready` }
    : { send: false, reason: `waiting: ${ready} of ${MORNING_EARLY_MIN_READY} categories ready` };
}

export type Record3 = { won: number; lost: number; void: number };

export type NightDigestData = {
  kind: "NIGHT";
  day: string;
  total: number;
  settled: number;
  pending: number;
  record: Record3;
  categories: { category: string; won: number; lost: number; void: number; pending: number }[];
  betOfTheDay: (DigestMatch & { outcome: string }) | null;
  items: DigestItem[];
};

export type NightDecision = { send: true; partial: boolean } | { send: false; reason: string };

/**
 * Whether the night digest should be created now, given the day's published picks.
 *
 *   before 23:00           never - the day is still being played.
 *   23:00 up to 23:55      created once all picks have settled, or at least
 *                          NIGHT_SUBSTANTIAL_SETTLED_SHARE of them; otherwise
 *                          deferred to the next reminders run.
 *   23:55 (hard cutoff)    created with whatever has settled, as a partial
 *                          "Results so far" summary with the unsettled count.
 *
 * Nothing settled at all means no digest. It never claims the day is complete
 * when it is not: `partial` is true whenever anything is still pending.
 */
export function nightDigestDecision(picks: Pick<DigestPick, "outcome">[], now: Date): NightDecision {
  const minute = lagosMinuteOfDay(now);
  if (minute < DIGEST_TIMING.nightFrom) return { send: false, reason: "before 23:00" };
  if (!picks.length) return { send: false, reason: "no published picks today" };
  const pending = picks.filter((p) => p.outcome === "PENDING").length;
  if (pending === 0) return { send: true, partial: false };
  if (pending === picks.length) return { send: false, reason: minute >= DIGEST_TIMING.nightDeadline ? "nothing settled by the cutoff" : "nothing settled yet" };
  const share = (picks.length - pending) / picks.length;
  if (share >= NIGHT_SUBSTANTIAL_SETTLED_SHARE || minute >= DIGEST_TIMING.nightDeadline) return { send: true, partial: true };
  return { send: false, reason: `deferred: ${pending} still unsettled` };
}

function tally(picks: Pick<DigestPick, "outcome">[]): Record3 {
  return {
    won: picks.filter((p) => p.outcome === "WON").length,
    lost: picks.filter((p) => p.outcome === "LOST").length,
    void: picks.filter((p) => p.outcome === "VOID").length,
  };
}

export function buildNightDigest(picks: DigestPick[], betOfTheDayId: string | null, now: Date): NightDigestData {
  const settled = picks.filter((p) => p.outcome !== "PENDING");
  const categories = (["BET_OF_THE_DAY", ...DIGEST_CATEGORY_ORDER] as string[])
    .map((category) => {
      const inCat = picks.filter((p) => hasCategory(p, category));
      return { category, ...tally(inCat), pending: inCat.filter((p) => p.outcome === "PENDING").length, size: inCat.length };
    })
    .filter((c) => c.size > 0)
    .map(({ size: _size, ...c }) => c);
  const botd = betOfTheDayId ? picks.find((p) => p.id === betOfTheDayId) ?? null : null;
  return {
    kind: "NIGHT",
    day: lagosDay(now),
    total: picks.length,
    settled: settled.length,
    pending: picks.length - settled.length,
    record: tally(settled),
    categories,
    betOfTheDay: botd && botd.outcome !== "PENDING" ? { ...asMatch(botd), outcome: botd.outcome } : null,
    items: picks.map(asItem),
  };
}

export type RenderedDigest = { title: string; body: string; link: string; links: { label: string; href: string }[] };

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function matchName(m: Pick<DigestMatch, "homeTeam" | "awayTeam">) {
  return `${m.homeTeam} vs ${m.awayTeam}`;
}

/**
 * The digest as ONE viewer may see it.
 *
 * Category names and counts are shown to everyone: that a VIP slate exists is
 * not a pick. A selection is shown only when pickVisible() allows it, and a
 * locked category links to /pricing rather than to a page the viewer cannot
 * read. Pass `() => false` for paid categories to get the anonymous rendering,
 * which is what is stored on the event row as a safe default.
 */
export function renderDigest(data: MorningDigestData | NightDigestData, canView: (category: string) => boolean): RenderedDigest {
  const linkFor = (category: string) => (canView(category) ? CATEGORY_PATH[category] ?? "/predictions" : "/pricing");

  if (data.kind === "MORNING") {
    const names = data.categories.map((c) => CATEGORY_LABEL[c.category] ?? c.category);
    const title = names.length ? `Today's ${joinNames(names)} picks are ready` : data.betOfTheDay ? "Today's Bet of the Day is ready" : "Today's top picks are ready";
    const lines: string[] = [];
    if (data.betOfTheDay) {
      lines.push(
        pickVisible(data.betOfTheDay, canView)
          ? `Bet of the Day: ${matchName(data.betOfTheDay)} — ${data.betOfTheDay.pick}`
          : `Bet of the Day: ${matchName(data.betOfTheDay)}`,
      );
    }
    const top = data.highlights.filter((h) => pickVisible(h, canView));
    if (top.length) lines.push(`Top: ${top.map((h) => `${matchName(h)} (${h.pick})`).join("; ")}`);
    if (data.categories.length) {
      lines.push(data.categories.map((c) => `${CATEGORY_LABEL[c.category] ?? c.category} ${c.count}${canView(c.category) ? "" : " (members)"}`).join(" · "));
    }
    const links = [
      ...(data.betOfTheDay ? [{ label: "Bet of the Day", href: linkFor("BET_OF_THE_DAY") }] : []),
      ...data.categories.map((c) => ({ label: CATEGORY_LABEL[c.category] ?? c.category, href: linkFor(c.category) })),
      ...top.map((h) => ({ label: matchName(h), href: h.link })),
    ];
    return { title, body: lines.join("\n"), link: data.betOfTheDay ? "/predictions/bet-of-the-day" : "/predictions/today", links };
  }

  const r = data.record;
  const record = `${r.won} won, ${r.lost} lost${r.void ? `, ${r.void} void` : ""}`;
  const title = data.pending ? `Results so far: ${record}` : `Today's results: ${record}`;
  const lines: string[] = [];
  if (data.betOfTheDay) {
    lines.push(
      pickVisible(data.betOfTheDay, canView)
        ? `Bet of the Day: ${matchName(data.betOfTheDay)} — ${data.betOfTheDay.pick}: ${data.betOfTheDay.outcome}`
        : `Bet of the Day: ${data.betOfTheDay.outcome}`,
    );
  }
  const completed = data.categories.filter((c) => c.pending === 0 && c.category !== "BET_OF_THE_DAY");
  const perCategory = data.categories
    .filter((c) => c.category !== "BET_OF_THE_DAY" && c.won + c.lost + c.void > 0)
    .map((c) => `${CATEGORY_LABEL[c.category] ?? c.category} ${c.won}–${c.lost}`);
  if (perCategory.length) lines.push(perCategory.join(" · "));
  if (completed.length) lines.push(`Completed: ${completed.map((c) => CATEGORY_LABEL[c.category] ?? c.category).join(", ")}`);
  lines.push(data.pending ? `${data.settled} of ${data.total} settled — ${data.pending} still awaiting results.` : `All ${data.total} of today's picks settled.`);
  return { title, body: lines.join("\n"), link: "/track-record", links: [{ label: "Track record", href: "/track-record" }] };
}

export type FollowRow = { targetType: string; targetKey: string };

/**
 * Whether a follow row covers this pick. The same targets followTargets() in
 * notifications.ts gives a NEW_PREDICTION / RESULT_* event for the pick
 * (prediction, either team, any of its categories, its league), so a follower
 * sees in the digest exactly the picks they would have been alerted about one
 * by one. scripts/check-notification-digest.ts asserts the two agree.
 */
export function followCoversItem(follow: FollowRow, item: Pick<DigestItem, "id" | "category" | "categories" | "leagueApiId" | "teamApiIds">) {
  switch (follow.targetType) {
    case "PREDICTION":
      return follow.targetKey === item.id;
    case "TEAM":
      return item.teamApiIds.map(String).includes(follow.targetKey);
    case "CATEGORY":
      return follow.targetKey === item.category || item.categories.includes(follow.targetKey);
    case "LEAGUE":
      return item.leagueApiId != null && follow.targetKey === String(item.leagueApiId);
    default:
      return false;
  }
}

/**
 * Which parts of a digest this recipient gets.
 *
 *   editorial - opted into editorial alerts: the full BetGenius digest.
 *   followed  - follow-driven alerts on (followedAlerts, and newPredictions for
 *               the morning / results for the night): a section scoped to the
 *               picks their follows cover, and nothing from the global slate.
 *
 * Both: one combined digest. Neither: nothing. There is one event per digest
 * per day and one delivery per user per event, so a user can never get two.
 */
export type DigestAudience = { editorial: boolean; followed: boolean; follows: FollowRow[] };

export function digestAudienceFor(
  type: string,
  pref: { editorialAlerts?: boolean; followedAlerts?: boolean; newPredictions?: boolean; results?: boolean } | null | undefined,
  follows: FollowRow[],
): DigestAudience {
  const followedOn = (pref?.followedAlerts ?? true) && (type === DIGEST_NIGHT ? pref?.results ?? true : pref?.newPredictions ?? true);
  return { editorial: pref?.editorialAlerts === true, followed: followedOn && follows.length > 0, follows };
}

const FOLLOWED_LIST_MAX = 3;

function followedSection(
  data: MorningDigestData | NightDigestData,
  items: DigestItem[],
  canView: (category: string) => boolean,
): { title: string; lines: string[]; link: string; links: { label: string; href: string }[] } | null {
  const relevant = data.kind === "NIGHT" ? items.filter((i) => i.outcome !== "PENDING") : items;
  if (!relevant.length) return null;
  const visible = relevant.filter((i) => pickVisible(i, canView));
  const locked = relevant.length - visible.length;
  const shown = visible.slice(0, FOLLOWED_LIST_MAX);
  const more = visible.length - shown.length;
  const lines: string[] = [];
  const describe = (i: DigestItem) => (data.kind === "NIGHT" ? `${matchName(i)} — ${i.pick}: ${i.outcome}` : `${matchName(i)} (${i.pick})`);
  if (shown.length) lines.push(`Your follows: ${shown.map(describe).join("; ")}${more > 0 ? ` +${more} more` : ""}`);
  // A locked pick is counted, never named: which match a paid pick is on is part of the pick.
  if (locked) lines.push(`${locked} members-only pick${locked === 1 ? "" : "s"} on what you follow.`);
  const links = [...shown.map((i) => ({ label: matchName(i), href: i.link })), ...(locked ? [{ label: "Members-only picks", href: "/pricing" }] : [])];

  if (data.kind === "MORNING") {
    return { title: `${relevant.length} pick${relevant.length === 1 ? "" : "s"} today on what you follow`, lines, link: "/following", links };
  }
  const r = tally(relevant);
  const record = `${r.won} won, ${r.lost} lost${r.void ? `, ${r.void} void` : ""}`;
  const pendingFollowed = items.length - relevant.length;
  if (pendingFollowed) lines.push(`${pendingFollowed} of yours still awaiting results.`);
  return { title: pendingFollowed ? `Your follows so far: ${record}` : `Your follows today: ${record}`, lines, link: "/following", links };
}

/**
 * The digest for one recipient, or null when there is nothing for them in it
 * (neither audience applies, or a follower-only reader follows nothing in
 * today's picks). Entitlement is applied throughout via `canView`.
 */
export function personaliseDigest(
  data: MorningDigestData | NightDigestData,
  audience: DigestAudience,
  canView: (category: string) => boolean,
): RenderedDigest | null {
  const items = audience.followed ? (data.items ?? []).filter((i) => audience.follows.some((f) => followCoversItem(f, i))) : [];
  const section = items.length ? followedSection(data, items, canView) : null;
  if (audience.editorial) {
    const global = renderDigest(data, canView);
    if (!section) return global;
    const seen = new Set(global.links.map((l) => l.href));
    return {
      ...global,
      body: [global.body, ...section.lines].join("\n"),
      links: [...global.links, ...section.links.filter((l) => !seen.has(l.href))],
    };
  }
  if (!section) return null;
  return { title: section.title, body: section.lines.join("\n"), link: section.link, links: section.links };
}

/**
 * Whether a delivered notification also rings the device. Inbox-only types
 * never do; everything else still needs push enabled and must be outside the
 * user's quiet hours. The inbox row is written either way.
 */
export function shouldPush(type: string, opts: { pushEnabled: boolean; inQuietHours: boolean; leagueApiId?: number | null; data?: unknown }) {
  return !isInboxOnlyEvent({ type, leagueApiId: opts.leagueApiId, data: opts.data }) && opts.pushEnabled && !opts.inQuietHours;
}

const PAID_CATEGORIES = new Set(["VIP", "PREMIUM"]);

/**
 * The lock-screen copy for one recipient. A digest must already have been
 * personalised for them (`digest`), so its content matches their audience and
 * entitlement; any other paid-tier event keeps its generic line, because a
 * lock screen is not an entitlement check.
 */
export function pushCopy(
  event: { type: string; title: string; body: string; link: string; category: string | null },
  digest?: RenderedDigest | null,
) {
  if (isDigestEvent(event.type)) {
    // No personalised copy means nothing for this recipient: never fall back to
    // the stored global rendering, which a follower-only user must not get.
    if (!digest) return null;
    return { title: digest.title, body: digest.body, url: digest.link };
  }
  const body = event.category && PAID_CATEGORIES.has(event.category) ? "A followed tip has an update." : event.body;
  return { title: event.title, body, url: event.link };
}

/** Narrow an event's stored `data` back to a digest payload, or null when it is not one. */
export function digestData(data: unknown): MorningDigestData | NightDigestData | null {
  const d = data as { kind?: unknown } | null;
  return d && (d.kind === "MORNING" || d.kind === "NIGHT") ? (d as MorningDigestData | NightDigestData) : null;
}
