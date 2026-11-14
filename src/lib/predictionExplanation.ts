import type { TeamDigest } from "./ai/digest";
import { isValidSelection, MARKET_TYPES, type MarketType } from "./markets";
import { toBookmakerSelection } from "./odds";
import { auditPublicationQuoteEvidence } from "./paidEntryEvidence";

export const MARKET_MEANINGS: Record<string, string> = {
  MATCH_WINNER:
    "The named side must win in regulation time, including stoppage time. A draw is a separate result.",
  DOUBLE_CHANCE:
    "Either of the two named regulation-time results wins this market.",
  OVER_UNDER:
    "Compare the combined regulation-time goals with the stated line. Extra time is excluded; whole-goal lines may return the stake on an exact total.",
  BTTS: "Yes requires both teams to score in regulation time; No requires at least one team not to score.",
  DRAW_NO_BET:
    "The named side must win in regulation time; a draw returns the stake.",
  CORRECT_SCORE:
    "Both regulation-time goal totals must match the stated score exactly.",
  WIN_EITHER_HALF:
    "The named team must outscore the opponent in at least one half, considered separately.",
  HT_FT:
    "Both the half-time and regulation-time results must match the stated combination.",
  TEAM_TOTAL:
    "Compare the named team's regulation-time goals with the stated line.",
  EUROPEAN_HANDICAP:
    "Apply the stated goal adjustment, then resolve home, draw or away. An adjusted draw is a separate selection.",
  SAME_GAME_DOUBLE:
    "Both selections on this fixture must succeed; a single winning leg does not win the double.",
};
export function identityDigest(
  d: TeamDigest | null | undefined,
  id: number | null,
) {
  return id != null && d?.apiId === id ? d : null;
}

/** Counts of historical observations, never a probability or a generated reason. */
export function selectionObservations(input: {
  marketType: string;
  selection: unknown;
  kickoff: Date;
  home: TeamDigest | null;
  away: TeamDigest | null;
  now?: Date;
}) {
  if (
    !(MARKET_TYPES as readonly string[]).includes(input.marketType) ||
    !isValidSelection(input.marketType as MarketType, input.selection)
  )
    return [];
  const s = input.selection as Record<string, any>;
  const observations: Array<{
    team: string;
    support: number;
    against: number;
    neutral: number;
    sample: number;
    latest: string;
  }> = [];
  for (const [side, digest] of [
    ["HOME", input.home],
    ["AWAY", input.away],
  ] as const) {
    if (!digest) continue;
    let rows = digest.last5.filter(
      (f) =>
        Number.isFinite(Date.parse(f.date)) &&
        Date.parse(f.date) < +input.kickoff &&
        Date.parse(f.date) <= +(input.now ?? new Date()) &&
        typeof f.goalsFor === "number" &&
        typeof f.goalsAgainst === "number" &&
        Number.isInteger(f.goalsFor) &&
        Number.isInteger(f.goalsAgainst) &&
        f.goalsFor >= 0 &&
        f.goalsAgainst >= 0,
    );
    rows = [
      ...new Map(
        rows.map((r) => [`${r.date}:${r.opponentApiId ?? r.opponent}`, r]),
      ).values(),
    ].slice(-5);
    if (!rows.length) continue;
    const resolve = (f: (typeof rows)[number]): boolean | null | undefined => {
      const gf = f.goalsFor!,
        ga = f.goalsAgainst!;
      if (input.marketType === "OVER_UNDER")
        return gf + ga === s.line
          ? null
          : s.direction === "OVER"
            ? gf + ga > s.line
            : gf + ga < s.line;
      if (input.marketType === "BTTS")
        return s.value === "YES" ? gf > 0 && ga > 0 : gf === 0 || ga === 0;
      if (input.marketType === "MATCH_WINNER") {
        if (s.value === "DRAW") return gf === ga;
        return s.value === side ? gf > ga : undefined;
      }
      if (input.marketType === "DRAW_NO_BET")
        return s.value === side ? (gf === ga ? null : gf > ga) : undefined;
      if (input.marketType === "DOUBLE_CHANCE") {
        if (s.value === "HOME_OR_AWAY") return gf !== ga;
        return s.value === `${side}_OR_DRAW` ? gf >= ga : undefined;
      }
      return undefined;
    };
    const outcomes = rows.map(resolve).filter((v) => v !== undefined);
    if (!outcomes.length) continue;
    observations.push({
      team: digest.name,
      support: outcomes.filter((v) => v === true).length,
      against: outcomes.filter((v) => v === false).length,
      neutral: outcomes.filter((v) => v === null).length,
      sample: outcomes.length,
      latest: rows
        .map((f) => f.date)
        .sort()
        .at(-1)!,
    });
  }
  return observations;
}
export function publicationObservation(input: {
  confirmation: unknown;
  kickoff: Date;
  publishedAt: Date | null;
  marketType: string;
  selection: unknown;
}) {
  const audit = auditPublicationQuoteEvidence(
    input.confirmation,
    input.kickoff,
  );
  if (!audit.usable || !input.publishedAt) return null;
  const snapshot = (input.confirmation as any).publicationQuoteEvidence;
  const mapped = toBookmakerSelection(input.marketType, input.selection);
  if (
    !mapped ||
    snapshot.entryQuoteSelection?.market !== mapped.market ||
    snapshot.entryQuoteSelection?.value !== mapped.value ||
    Date.parse(snapshot.confirmedAt) > +input.publishedAt
  )
    return null;
  const sources = snapshot.entryQuoteSources.filter(
    (q: any) =>
      typeof q?.bookmaker === "string" &&
      q.bookmaker.trim() &&
      Number.isFinite(q.odd) &&
      q.odd > 1,
  ) as Array<{ bookmaker: string; odd: number }>;
  return {
    median: snapshot.entryPrice as number,
    at: new Date(snapshot.quoteFetchedAt),
    sources,
  };
}
