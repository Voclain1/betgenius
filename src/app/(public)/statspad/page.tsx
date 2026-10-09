"use client";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { LEAGUE_CATALOGUE, LEAGUE_TIER_LABELS } from "@/lib/leagues";
import { cupSupports } from "@/lib/cupConfig";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { AdLeaderboard } from "@/components/ads/AdPlacements";

const STANDINGS_COMPETITIONS = LEAGUE_CATALOGUE.filter((league) => cupSupports(league.id, "standings"));
const LEAGUE_TIERS = Array.from(new Set(STANDINGS_COMPETITIONS.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: STANDINGS_COMPETITIONS.filter((l) => l.tier === tier),
}));

type Row = {
  rank: number;
  team: { name: string; logo?: string };
  goalsDiff: number;
  form?: string;
  all: { played: number; goals: { for: number; against: number } };
};

const FORM_TONE: Record<string, string> = { W: "text-emerald-400", D: "text-gray-400", L: "text-red-400" };
/** Points from the recent-form string (W 3, D 1), so "best form" ranks by form rather than by table position. */
const formPoints = (form?: string) => (form ?? "").split("").reduce((n, ch) => n + (ch === "W" ? 3 : ch === "D" ? 1 : 0), 0);

function Board({ kicker, title, rows, value }: { kicker: string; title: string; rows: Row[]; value: (r: Row) => React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-brand-border bg-brand-card p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{kicker}</div>
      <h2 className="mt-1 text-xl font-black tracking-tight text-gray-100">{title}</h2>
      <ol className="mt-4 divide-y divide-brand-border">
        {rows.map((r, i) => (
          <li key={r.team.name} className="flex items-center gap-3 py-2.5">
            <span className={`w-5 shrink-0 text-right text-sm font-black tabular-nums ${i === 0 ? "text-brand" : "text-gray-500"}`}>{i + 1}</span>
            {r.team.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.team.logo} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 shrink-0 object-contain" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-100">{r.team.name}</span>
            <span className="shrink-0 text-base font-black tabular-nums text-gray-100">{value(r)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function StatsPad() {
  const [leagueId, setLeagueId] = useState(39);
  const [table, setTable] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // Loads on every league change, like Standings — no separate "Load" step.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const j = await fetch(`/api/standings?league=${leagueId}`).then((r) => r.json()).catch(() => ({}));
      if (!alive) return;
      setTable(j.table || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  const league = STANDINGS_COMPETITIONS.find((l) => l.id === leagueId);
  const played = table.reduce((n, r) => n + r.all.played, 0);
  const goals = table.reduce((n, r) => n + r.all.goals.for, 0);
  // Every match is counted twice across the table (once per side).
  const matches = played / 2;

  return (
    <div className="space-y-6">
      <CategoryMasthead
        kicker="Season numbers"
        title="StatsPad"
        blurb={`The leaders behind the table${league ? ` in ${league.name}` : ""}: best attack, tightest defence, form and goal difference.`}
        stats={
          !loading && table.length > 0
            ? [
                { label: "Goals", value: String(goals), accent: true },
                { label: "Per match", value: matches > 0 ? (goals / matches).toFixed(2) : "–" },
                { label: "Teams", value: String(table.length) },
              ]
            : []
        }
        actions={
          <label className="relative block w-full sm:w-80">
            <span className="sr-only">League</span>
            <select
              value={leagueId}
              onChange={(e) => setLeagueId(Number(e.target.value))}
              className="w-full appearance-none rounded-2xl border border-brand-border bg-brand-bg py-3 pl-4 pr-10 text-sm font-bold text-gray-100 transition hover:border-brand/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              {LEAGUE_TIERS.map((g) => (
                <optgroup key={g.tier} label={g.label} className="bg-brand-bg text-gray-300">
                  {g.leagues.map((l) => (
                    <option key={l.id} value={l.id} className="bg-brand-bg text-gray-100">
                      {l.name}
                      {l.country !== "World" ? ` (${l.country})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-brand" />
          </label>
        }
      />

      {/* After the first main content section — the heading and the league
          picker — rather than under the boards at the foot. */}
      <AdLeaderboard />

      {loading && <div className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm text-gray-400">Loading…</div>}

      {!loading && table.length === 0 && (
        <div className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm text-gray-400">No stats available for this competition yet.</div>
      )}

      {!loading && table.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Board kicker="Attack" title="Most goals scored" rows={[...table].sort((a, b) => b.all.goals.for - a.all.goals.for).slice(0, 5)} value={(r) => r.all.goals.for} />
          <Board kicker="Defence" title="Fewest goals conceded" rows={[...table].sort((a, b) => a.all.goals.against - b.all.goals.against).slice(0, 5)} value={(r) => r.all.goals.against} />
          <Board
            kicker="Form"
            title="Best recent form"
            rows={[...table].filter((r) => r.form).sort((a, b) => formPoints(b.form) - formPoints(a.form) || a.rank - b.rank).slice(0, 5)}
            value={(r) => (
              <span className="flex gap-1 text-[11px]">
                {(r.form ?? "").split("").map((ch, i) => (
                  <span key={i} className={FORM_TONE[ch] ?? "text-gray-500"}>
                    {ch}
                  </span>
                ))}
              </span>
            )}
          />
          <Board kicker="Balance" title="Goal difference" rows={[...table].sort((a, b) => b.goalsDiff - a.goalsDiff).slice(0, 5)} value={(r) => `${r.goalsDiff > 0 ? "+" : ""}${r.goalsDiff}`} />
        </div>
      )}
    </div>
  );
}
