import type { FixtureRow } from "@/lib/football/api-football";

export const INSIGHT_VERSION = "1";
export const INSIGHT_MAX_AGE_MS = 6 * 60 * 60_000;
export const MIN_SAMPLE = 5;
const FINISHED = new Set(["FT", "AET", "PEN"]);

export type InsightScope = "ALL" | "HOME" | "AWAY" | "COMPETITION";
export type InsightType =
  | "UNBEATEN_STREAK" | "WIN_STREAK" | "LOSS_STREAK" | "WINLESS_STREAK"
  | "OVER_25" | "BTTS" | "SCORED_2" | "CLEAN_SHEET" | "FAILED_TO_SCORE";

export type InsightEvidence = {
  type: InsightType;
  teamApiId: number;
  teamName: string;
  leagueApiId: number | null;
  leagueName: string | null;
  scope: InsightScope;
  count: number;
  sampleSize: number;
  exact: boolean;
  matchIds: number[];
  explanation: string;
  refreshedAt: string;
  calculationVersion: string;
};

type Options = { teamApiId: number; teamName: string; leagueApiId?: number | null; leagueName?: string | null; scope?: InsightScope; cutoff: Date; refreshedAt: Date };

function eligible(f: FixtureRow, o: Options) {
  if (!FINISHED.has(f.fixture.status.short) || new Date(f.fixture.date) >= o.cutoff) return false;
  if (f.goals.home == null || f.goals.away == null) return false;
  if (f.teams.home.id !== o.teamApiId && f.teams.away.id !== o.teamApiId) return false;
  if (o.scope === "HOME" && f.teams.home.id !== o.teamApiId) return false;
  if (o.scope === "AWAY" && f.teams.away.id !== o.teamApiId) return false;
  if (o.scope === "COMPETITION" && f.league.id !== o.leagueApiId) return false;
  return true;
}

function ordered(rows: FixtureRow[], o: Options) {
  const byId = new Map<number, FixtureRow>();
  for (const f of rows) if (eligible(f, o)) byId.set(f.fixture.id, f);
  return [...byId.values()].sort((a, b) => +new Date(b.fixture.date) - +new Date(a.fixture.date));
}

function teamScore(f: FixtureRow, teamId: number) {
  const home = f.teams.home.id === teamId;
  return { own: (home ? f.goals.home : f.goals.away)!, against: (home ? f.goals.away : f.goals.home)! };
}

export function calculateInsights(input: unknown, options: Options): InsightEvidence[] {
  if (!Array.isArray(input)) return [];
  const rows = ordered(input as FixtureRow[], { ...options, scope: options.scope ?? "ALL" });
  if (rows.length < MIN_SAMPLE) return [];
  const scope = options.scope ?? "ALL";
  const tests: Array<[InsightType, (own: number, against: number) => boolean, boolean]> = [
    ["UNBEATEN_STREAK", (a, b) => a >= b, true], ["WIN_STREAK", (a, b) => a > b, true],
    ["LOSS_STREAK", (a, b) => a < b, true], ["WINLESS_STREAK", (a, b) => a <= b, true],
    ["OVER_25", (a, b) => a + b > 2, false], ["BTTS", (a, b) => a > 0 && b > 0, false],
    ["SCORED_2", (a) => a >= 2, false], ["CLEAN_SHEET", (_a, b) => b === 0, false],
    ["FAILED_TO_SCORE", (a) => a === 0, false],
  ];
  const labels: Record<InsightType, string> = {
    UNBEATEN_STREAK: "unbeaten", WIN_STREAK: "wins", LOSS_STREAK: "losses", WINLESS_STREAK: "without a win",
    OVER_25: "over 2.5 goals", BTTS: "both teams scored", SCORED_2: "scored at least two goals",
    CLEAN_SHEET: "clean sheets", FAILED_TO_SCORE: "failed to score",
  };
  return tests.flatMap(([type, test, streak]) => {
    const flags = rows.map((f) => { const s = teamScore(f, options.teamApiId); return test(s.own, s.against); });
    const count = streak ? flags.findIndex((v) => !v) : flags.slice(0, 10).filter(Boolean).length;
    const actual = streak ? (count === -1 ? flags.length : count) : count;
    const sampleSize = streak ? actual : Math.min(10, rows.length);
    const threshold = streak ? 3 : Math.ceil(sampleSize * 0.7);
    if (actual < threshold) return [];
    const exact = !streak || actual < rows.length;
    const prefix = streak && !exact ? "At least " : "";
    const explanation = streak
      ? `${prefix}${actual} consecutive matches ${labels[type]}.`
      : `${labels[type][0].toUpperCase()}${labels[type].slice(1)} in ${actual} of the last ${sampleSize} matches.`;
    return [{ type, teamApiId: options.teamApiId, teamName: options.teamName, leagueApiId: options.leagueApiId ?? null, leagueName: options.leagueName ?? null, scope, count: actual, sampleSize, exact, matchIds: rows.slice(0, sampleSize).map((f) => f.fixture.id), explanation, refreshedAt: options.refreshedAt.toISOString(), calculationVersion: INSIGHT_VERSION }];
  });
}

