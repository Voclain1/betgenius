import type { TeamDigest } from "@/lib/ai/digest";
import { computeFormRating, FORM_BAND_STYLES } from "@/lib/form";
import { PremiumPanel } from "@/components/PremiumPanel";
import { textTone } from "@/lib/tone";

type Fixture = TeamDigest["last5"][number];

const RESULT_TONE: Record<string, string> = { W: "text-emerald-300", D: "text-gray-300", L: "text-red-300" };
const RESULT_WORD: Record<string, string> = { W: "Win", D: "Draw", L: "Loss" };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });

/** The result letter on the tile's own neutral surface — colour on the letter, never a tinted pill behind it. */
function ResultTile({ result, size = "sm" }: { result: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10 rounded-xl text-base" : "h-9 w-9 rounded-lg text-sm";
  return (
    <span
      title={RESULT_WORD[result]}
      className={`grid shrink-0 place-items-center border border-brand-border bg-brand-bg font-black ${box} ${RESULT_TONE[result] ?? "text-gray-400"}`}
    >
      {result}
    </span>
  );
}

function TeamForm({ name, digest, side }: { name: string; digest: TeamDigest | null; side: "Home" | "Away" }) {
  const rows: Fixture[] = [...(digest?.last5 ?? [])]
    .filter((f) => /^[WDL]$/.test(f.result))
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
            {[...rows].reverse().map((f, i) => <ResultTile key={`${f.date}-${i}`} result={f.result} size="lg" />)}
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Latest →</span>
          </div>

          <ul className="mt-5 divide-y divide-brand-border border-t border-brand-border">
            {rows.map((f, i) => (
              <li key={`${f.date}-${i}`} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <ResultTile result={f.result} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-gray-100">
                    <span className="mr-1.5 text-xs font-semibold text-gray-500">{f.venue === "home" ? "vs" : "at"}</span>
                    {f.opponent}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">
                    <time dateTime={f.date}>{day(f.date)}</time> · {f.competition ?? "Competition not recorded"}
                  </div>
                </div>
                <strong className="shrink-0 text-lg font-black tabular-nums tracking-tight text-gray-100">
                  {f.goalsFor == null || f.goalsAgainst == null ? <span className="text-xs font-semibold text-gray-500">Score n/a</span> : `${f.goalsFor}–${f.goalsAgainst}`}
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

export function MatchRecentResults({ home, away, homeTeam, awayTeam }: { home: TeamDigest | null; away: TeamDigest | null; homeTeam: string; awayTeam: string }) {
  if (!home?.last5.length && !away?.last5.length) return null;
  return (
    <PremiumPanel bare kicker="Form" title="Recent form and results" id="form">
      <div className="grid gap-4 md:grid-cols-2">
        <TeamForm name={homeTeam} digest={home} side="Home" />
        <TeamForm name={awayTeam} digest={away} side="Away" />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        Last five completed matches across all competitions. Scores are from the named team’s perspective; “vs” is a home match, “at” an away one. The form rating (0–100) weights recent results more heavily and does not account for opponent strength.
      </p>
    </PremiumPanel>
  );
}
