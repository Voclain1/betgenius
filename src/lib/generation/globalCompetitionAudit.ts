/**
 * Sprint 05 (continuation): evidence-based eligibility for competitions that
 * are NOT in the league catalogue, worldwide.
 *
 * The evidence for each competition comes from one bounded provider probe
 * (scripts/research-global-competitions.ts): the provider's own season and
 * coverage flags, fixtures scheduled in the next 3 days, finished fixtures in
 * the last 7 with their scores, and a bookmaker sample. The decision rules
 * below were written BEFORE the probe ran and are applied mechanically; a
 * competition is never included or excluded for its country or reputation.
 *
 *   INCLUDE  every evaluation criterion is met: a candidate for the bounded
 *            evaluation lane / DEEP_FALLBACK under COVERAGE_ROLLOUT=on.
 *   WATCH    senior and current, but one data criterion is short (for
 *            example a bookmaker sample under 5 books, or too few recent
 *            results to judge): re-probe before deciding.
 *   EXCLUDE  structurally unsuitable: youth, reserve, friendly, no current
 *            season, no odds coverage, or no reliable results.
 */
export type CompetitionCategory = "senior" | "youth" | "reserve" | "womens" | "friendly" | "regional_amateur";

export type CompetitionEvidence = {
  id: number;
  name: string;
  country: string;
  type: "League" | "Cup" | string;
  season: number | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  current: boolean;
  coverage: { odds: boolean; standings: boolean; fixtureStats: boolean; events: boolean; lineups: boolean };
  /** Fixtures not started, kicking off in the probe's forward window. */
  upcoming: number;
  /** Finished fixtures in the probe's backward window, and how many had FT / HT scores. */
  finished: number;
  finishedWithScore: number;
  finishedWithHalfTime: number;
  /** Bookmaker counts on sampled upcoming fixtures (empty = not sampled). */
  sampledBookmakers: number[];
  /** Predictions BetGenius already holds for this competition id (any lane, probe window). */
  existingPredictions: number;
};

export type EligibilityDecision = "INCLUDE" | "WATCH" | "EXCLUDE";
export type EligibilityReason =
  | "YOUTH_COMPETITION" | "RESERVE_OR_B_COMPETITION" | "FRIENDLY" | "WOMENS_NEEDS_SENIOR_WOMENS_LANE" | "REGIONAL_AMATEUR_LEVEL"
  | "NO_CURRENT_SEASON" | "SEASON_ENDED" | "NO_ODDS_COVERAGE" | "NO_STANDINGS_COVERAGE"
  | "NO_UPCOMING_FIXTURES" | "TOO_FEW_RECENT_RESULTS" | "INCOMPLETE_RESULTS"
  | "BOOKMAKERS_NOT_SAMPLED" | "THIN_BOOKMAKER_MARKET"
  | "MEETS_ALL_CRITERIA";

/** Bars fixed before the probe ran. */
export const GLOBAL_ELIGIBILITY_POLICY = {
  MIN_BOOKMAKERS: 5, // same bar as MIN_BOOKMAKERS in odds.ts
  MIN_FINISHED_SAMPLE: 4,
  MIN_SCORE_COMPLETENESS: 0.9,
  MIN_UPCOMING: 1,
} as const;

const YOUTH = /\b(U-?\s?\d{2}|Under[- ]?\d{2}|Youth|Junior|Juniores|Juvenil|Primavera|Academy|Sub-?\d{2}|Jong|Reserve League|UEFA Youth)\b/i;
const RESERVE = /\b(Reserves?|B Team|U-?23 League|Premier League 2|Development League)\b/i;
const FRIENDLY = /\bFriendl(y|ies)\b/i;
const WOMENS = /\b(Women|Womens|Women's|Feminin[ao]?|Femenin[ao]?|Frauen|Damallsvenskan|Ladies|W-League|WSL|Feminine|Dames|Kvinner|Naiset|Kobiet|Elitettan|Toppserien)\b/i;
/**
 * Regional / amateur pyramid levels, recognised by the provider's own naming:
 * a level number of 4 or more, or a regional group or division name. These are
 * EXCLUDED only when combined with thin markets, never on the name alone: see
 * decideEligibility, which puts a regional level that does have the data on WATCH.
 */
const REGIONAL = /\b(Oberliga|Regionalliga|Landesliga|Verbandsliga|Tercera|Group \d+|Groupe \d+|Grupo \d+|Gruppe|Divizie [A-Z]|Third League -|4\. liga|5\. liga|III Liga|IV Liga|Non League|Amateur|Regional|Serie D|Derde Divisie|Tweede Divisie|Division \d+ -|Liga Premier Serie B)\b/i;

export function categoryOf(e: Pick<CompetitionEvidence, "name">): CompetitionCategory {
  if (YOUTH.test(e.name)) return "youth";
  if (FRIENDLY.test(e.name)) return "friendly";
  if (WOMENS.test(e.name)) return "womens";
  if (RESERVE.test(e.name)) return "reserve";
  if (REGIONAL.test(e.name)) return "regional_amateur";
  return "senior";
}

const median = (xs: readonly number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

/** Apply the fixed rules. `asOf` is the probe date (YYYY-MM-DD). */
export function decideEligibility(e: CompetitionEvidence, asOf: string, policy = GLOBAL_ELIGIBILITY_POLICY): { decision: EligibilityDecision; reasons: EligibilityReason[]; category: CompetitionCategory } {
  const category = categoryOf(e);
  const structural: EligibilityReason[] = [];
  if (category === "youth") structural.push("YOUTH_COMPETITION");
  if (category === "reserve") structural.push("RESERVE_OR_B_COMPETITION");
  if (category === "friendly") structural.push("FRIENDLY");
  if (!e.current || e.season == null) structural.push("NO_CURRENT_SEASON");
  else if (e.seasonEnd && e.seasonEnd < asOf) structural.push("SEASON_ENDED");
  if (!e.coverage.odds) structural.push("NO_ODDS_COVERAGE");
  if (e.finished >= policy.MIN_FINISHED_SAMPLE && e.finishedWithScore / e.finished < policy.MIN_SCORE_COMPLETENESS) structural.push("INCOMPLETE_RESULTS");
  if (structural.length) return { decision: "EXCLUDE", reasons: structural, category };

  const data: EligibilityReason[] = [];
  if (category === "womens") data.push("WOMENS_NEEDS_SENIOR_WOMENS_LANE");
  if (e.type === "League" && !e.coverage.standings) data.push("NO_STANDINGS_COVERAGE");
  if (e.upcoming < policy.MIN_UPCOMING) data.push("NO_UPCOMING_FIXTURES");
  if (e.finished < policy.MIN_FINISHED_SAMPLE) data.push("TOO_FEW_RECENT_RESULTS");
  const books = median(e.sampledBookmakers);
  if (books == null) data.push("BOOKMAKERS_NOT_SAMPLED");
  else if (books < policy.MIN_BOOKMAKERS) data.push("THIN_BOOKMAKER_MARKET");
  // A regional/amateur level needs every data criterion; it is never included
  // on a single sample. It goes to WATCH even when the sample looks good.
  if (category === "regional_amateur") data.push("REGIONAL_AMATEUR_LEVEL");

  // Thin or absent bookmaker markets at regional level are structural: there
  // is no market to confirm against and none is likely to appear.
  if (category === "regional_amateur" && (books == null || books < policy.MIN_BOOKMAKERS)) {
    return { decision: "EXCLUDE", reasons: data, category };
  }
  if (data.length) return { decision: "WATCH", reasons: data, category };
  return { decision: "INCLUDE", reasons: ["MEETS_ALL_CRITERIA"], category };
}

/** Continent for reporting only. Decisions never read it. */
const REGIONS: Record<string, string> = {};
const put = (region: string, countries: string) => countries.split(",").forEach((c) => (REGIONS[c.trim().toLowerCase()] = region));
put("Europe", "England,Scotland,Wales,Northern-Ireland,Ireland,Spain,Portugal,France,Germany,Italy,Netherlands,Belgium,Luxembourg,Switzerland,Austria,Denmark,Sweden,Norway,Finland,Iceland,Faroe-Islands,Poland,Czech-Republic,Slovakia,Hungary,Romania,Bulgaria,Greece,Cyprus,Turkey,Serbia,Croatia,Slovenia,Bosnia,Montenegro,Albania,North-Macedonia,Kosovo,Ukraine,Belarus,Russia,Moldova,Lithuania,Latvia,Estonia,Georgia,Armenia,Azerbaijan,Kazakhstan,Israel,Malta,Andorra,San-Marino,Gibraltar,Liechtenstein");
put("Africa", "Nigeria,Ghana,South-Africa,Egypt,Morocco,Algeria,Tunisia,Kenya,Uganda,Tanzania,Rwanda,Ethiopia,Zambia,Zimbabwe,Cameroon,Ivory-Coast,Senegal,Mali,Burkina-Faso,Angola,Mozambique,Botswana,Namibia,Sudan,Libya,Congo,Congo-DR,Gabon,Benin,Togo,Guinea,Malawi,Burundi,Liberia,Sierra-Leone,Gambia,Mauritania,Niger,Madagascar,Mauritius,Eswatini,Lesotho");
put("Asia", "Japan,South-Korea,China,India,Saudi-Arabia,Qatar,United-Arab-Emirates,Iran,Iraq,Jordan,Kuwait,Bahrain,Oman,Syria,Lebanon,Uzbekistan,Tajikistan,Kyrgyzstan,Turkmenistan,Thailand,Vietnam,Malaysia,Indonesia,Singapore,Philippines,Myanmar,Cambodia,Hong-Kong,Taiwan,Bangladesh,Nepal,Pakistan,Sri-Lanka,Mongolia,Yemen,Palestine");
put("North America", "USA,Canada,Mexico,Costa-Rica,Honduras,Guatemala,El-Salvador,Panama,Nicaragua,Jamaica,Trinidad-And-Tobago,Haiti,Dominican-Republic,Cuba,Belize,Barbados,Bermuda,Curacao,Suriname,Puerto-Rico");
put("South America", "Brazil,Argentina,Colombia,Chile,Peru,Ecuador,Uruguay,Paraguay,Bolivia,Venezuela");
put("Oceania", "Australia,New-Zealand,Fiji,Papua-New-Guinea,Solomon-Islands,Vanuatu,Tahiti,New-Caledonia,Samoa,Tonga");
export function regionOf(country: string): string {
  if (/^world$/i.test(country)) return "International";
  return REGIONS[country.trim().toLowerCase()] ?? "Other";
}

export type AuditRow = CompetitionEvidence & { region: string; decision: EligibilityDecision; reasons: EligibilityReason[]; category: CompetitionCategory };

export function auditCompetitions(rows: readonly CompetitionEvidence[], asOf: string): AuditRow[] {
  return rows
    .map((e) => ({ ...e, region: regionOf(e.country), ...decideEligibility(e, asOf) }))
    .sort((a, b) => a.region.localeCompare(b.region) || a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
}

export function summariseAudit(rows: readonly AuditRow[]) {
  const by = <K extends string>(f: (r: AuditRow) => K) => rows.reduce<Record<string, Record<EligibilityDecision, number>>>((m, r) => {
    const k = f(r);
    (m[k] ??= { INCLUDE: 0, WATCH: 0, EXCLUDE: 0 })[r.decision]++;
    return m;
  }, {});
  const reasons: Record<string, number> = {};
  for (const r of rows) for (const x of r.reasons) reasons[x] = (reasons[x] ?? 0) + 1;
  return { total: rows.length, byRegion: by((r) => r.region), byCategory: by((r) => r.category), byType: by((r) => r.type), reasons };
}
