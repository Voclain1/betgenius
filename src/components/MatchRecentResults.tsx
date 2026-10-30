import type { TeamDigest } from "@/lib/ai/digest";
import { computeFormRating, FORM_BAND_STYLES } from "@/lib/form";
import { PremiumPanel } from "@/components/PremiumPanel";
import { textTone } from "@/lib/tone";
import { TeamCrest } from "@/components/TeamCrest";
import { CompetitionBadge } from "@/components/CompetitionBadge";
import type { InsightFixture } from "@/lib/insights";
import { normalizeLeagueName } from "@/lib/leagues";
import { normalizeName } from "@/lib/slug";

type Fixture = TeamDigest["last5"][number];

const RESULT_TONE: Record<string, string> = { W: "text-emerald-300", D: "text-gray-300", L: "text-red-300" };
const RESULT_WORD: Record<string, string> = { W: "Win", D: "Draw", L: "Loss" };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });

/** The result letter on the tile's own neutral surface — colour on the letter, never a tinted pill behind it. */
function ResultTile({ result }: { result: string }) {
  const box = "h-10 w-10 rounded-xl text-base";
  return (
    <span
      title={RESULT_WORD[result]}
      className={`grid shrink-0 place-items-center border border-brand-border bg-brand-bg font-black ${box} ${RESULT_TONE[result] ?? "text-gray-400"}`}
    >
      {result}
    </span>
  );
}

/**
 * Fills opponent and competition ids (and a missing competition name) from the
 * team's fuller fixture history, matched on date and opponent. Evidence stored
 * before those fields existed still gets crests and badges; a row with no
 * match keeps what it had, and the competition is then simply not shown.
 */
function withIds(f: Fixture, history: InsightFixture[]): Fixture {
  if (f.opponentApiId != null && f.competitionApiId != null && f.competition) return f;
  const opp = normalizeName(f.opponent);
  const hit = history.find((h) => h.date.slice(0, 10) === f.date.slice(0, 10) && (normalizeName(h.homeName) === opp || normalizeName(h.awayName) === opp));
  if (!hit) return f;
  const oppIsHome = normalizeName(hit.homeName) === opp;
  return {
    ...f,
    opponentApiId: f.opponentApiId ?? (oppIsHome ? hit.homeId : hit.awayId),
    competitionApiId: f.competitionApiId ?? hit.leagueId,
    competition: f.competition || hit.leagueName,
  };
}

/** Score with the result letter sitting on it, the letter coloured and the box neutral. */
function ScoreResult({ f }: { f: Fixture }) {
  const known = f.goalsFor != null && f.goalsAgainst != null;
  return (
    <div className="flex shrink-0 items-stretch overflow-hidden rounded-xl border border-brand-border bg-brand-bg" title={RESULT_WORD[f.result]}>
      <span className={`grid w-8 place-items-center text-xs font-black ${RESULT_TONE[f.result] ?? "text-gray-400"}`}>{f.result}</span>
      <span className="grid min-w-[3.25rem] place-items-center border-l border-brand-border px-2.5 py-1.5 text-base font-black tabular-nums tracking-tight text-gray-100">
        {known ? `${f.goalsFor}–${f.goalsAgainst}` : <span className="text-[10px] font-semibold text-gray-500">n/a</span>}
      </span>
    </div>
  );
}

function TeamForm({ name, digest, side, history }: { name: string; digest: TeamDigest | null; side: "Home" | "Away"; history: InsightFixture[] }) {
  const rows: Fixture[] = [...(digest?.last5 ?? [])]
    .filter((f) => /^[WDL]$/.test(f.result))
    .map((f) => withIds(f, history))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  const rating = computeFormRating(rows);
  const tally = { W: 0, D: 0, L: 0 } as Record<string, number>;
  let gf = 0, ga = 0, scored = 0;
  for (const f of rows) {
    tally[f.result]++;
    if (f.goalsFor != null && f.goalsAgainst != null) { gf += f.goalsFor; ga += f.goalsAgainst; scored++; }
  }

  return (
    <article className="min-w-0 rounded-3xl border border-brand-border bg-brand-card">
      <header className="flex items-start justify-between gap-4 p-5 pb-4 sm:p-6 sm:pb-5">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{side}</div>
          <h3 className="mt-1 truncate text-xl font-black tracking-tight text-gray-100">{name}</h3>
          {rows.length > 0 && (
            <p className="mt-1 text-xs tabular-nums text-gray-500">
              {tally.W}W {tally.D}D {tally.L}L
              {scored > 0 && <> · Goals {gf}–{ga}</>}
            </p>
          )}
          {rows.length > 0 && (
            <p className="mt-0.5 text-xs text-gray-500">
              {rows.length} {rows.length === 1 ? "match" : "matches"}, {day(rows[rows.length - 1].date)} to {day(rows[0].date)}
            </p>
          )}
        </div>
        {rating && (
          <div className="shrink-0 text-right">
            <div className="text-4xl font-black leading-none tabular-nums tracking-tight text-gray-100">{rating.score}</div>
            <div className={`mt-1 text-xs font-black ${textTone(FORM_BAND_STYLES[rating.band])}`}>{rating.band}</div>
          </div>
        )}
      </header>

      {!rows.length ? (
        <p className="px-5 pb-6 text-sm text-gray-400 sm:px-6">Recent results unavailable.</p>
      ) : (
        <>
          {/* Oldest to newest, left to right — the way a run reads. */}
          <div className="flex items-center gap-2 px-5 sm:px-6" aria-label={`${name} last ${rows.length} results, oldest first`}>
            {[...rows].reverse().map((f, i) => <ResultTile key={`${f.date}-${i}`} result={f.result} />)}
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Latest →</span>
          </div>

          <ul className="mt-5 divide-y divide-brand-border border-t border-brand-border">
            {rows.map((f, i) => (
              <li key={`${f.date}-${i}`} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <TeamCrest teamApiId={f.opponentApiId} name={f.opponent} size={36} className="rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-gray-100">
                    <span className="mr-1.5 text-xs font-semibold text-gray-500">{f.venue === "home" ? "vs" : "at"}</span>
                    {f.opponent}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
                    <time dateTime={f.date} className="shrink-0">{day(f.date)}</time>
                    {f.competition && (
                      <>
                        <span aria-hidden>·</span>
                        <CompetitionBadge leagueApiId={f.competitionApiId} />
                        <span className="truncate">{normalizeLeagueName(f.competition) ?? f.competition}</span>
                      </>
                    )}
                  </div>
                </div>
                <ScoreResult f={f} />
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

export function MatchRecentResults({ home, away, homeTeam, awayTeam, homeHistory = [], awayHistory = [] }: { home: TeamDigest | null; away: TeamDigest | null; homeTeam: string; awayTeam: string; homeHistory?: InsightFixture[]; awayHistory?: InsightFixture[] }) {
  if (!home?.last5.length && !away?.last5.length) return null;
  return (
    <PremiumPanel bare kicker="Form" title="Recent form and results" id="form">
      <div className="grid gap-4 md:grid-cols-2">
        <TeamForm name={homeTeam} digest={home} side="Home" history={homeHistory} />
        <TeamForm name={awayTeam} digest={away} side="Away" history={awayHistory} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        Last five completed matches across all competitions. Scores are from the named team’s perspective; “vs” is a home match, “at” an away one. The form rating (0–100) weights recent results more heavily and does not account for opponent strength.
      </p>
    </PremiumPanel>
  );
}
