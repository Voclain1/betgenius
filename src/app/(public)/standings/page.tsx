"use client";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { LEAGUE_CATALOGUE, LEAGUE_TIER_LABELS } from "@/lib/leagues";
import { cupSupports } from "@/lib/cupConfig";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { AdHalfBanner } from "@/components/ads/AdPlacements";

const STANDINGS_COMPETITIONS = LEAGUE_CATALOGUE.filter((league) => cupSupports(league.id, "standings"));
const LEAGUE_TIERS = Array.from(new Set(STANDINGS_COMPETITIONS.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: STANDINGS_COMPETITIONS.filter((l) => l.tier === tier),
}));

/**
 * Rows shown before "Show more", and how many each press adds.
 *
 * The page used to render the whole table at once — 20 rows for most leagues,
 * which is a long scroll on a phone before anything else on the page. Ten is
 * the top half of a 20-team division: enough to cover the title race and the
 * European places, which is what someone opening a table on a phone is
 * usually checking.
 */
const PAGE_SIZE = 10;

type Goals = { for: number; against: number };

type Row = {
  rank: number;
  team: { name: string; logo?: string };
  points: number;
  goalsDiff: number;
  form?: string;
  all: { played: number; win: number; draw: number; lose: number; goals?: Goals };
};

/** Every stat column, in league-table order. Kept as data so the header and
 *  the body can't drift out of alignment as columns are added. */
const STAT_COLUMNS: { key: string; label: string; value: (r: Row) => number | string }[] = [
  { key: "P", label: "P", value: (r) => r.all.played },
  { key: "W", label: "W", value: (r) => r.all.win },
  { key: "D", label: "D", value: (r) => r.all.draw },
  { key: "L", label: "L", value: (r) => r.all.lose },
  { key: "GF", label: "GF", value: (r) => r.all.goals?.for ?? "—" },
  { key: "GA", label: "GA", value: (r) => r.all.goals?.against ?? "—" },
  { key: "GD", label: "GD", value: (r) => r.goalsDiff },
];

const FORM_TONE: Record<string, string> = { W: "text-emerald-400", D: "text-gray-400", L: "text-red-400" };

export default function StandingsPage() {
  const [leagueId, setLeagueId] = useState(39);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const j = await fetch(`/api/standings?league=${leagueId}`).then((r) => r.json());
      setRows(j.table || []);
      setLoading(false);
    })();
  }, [leagueId]);

  // A new league starts collapsed again — carrying an expanded table over
  // from the last one would drop the reader into the middle of a fresh table.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [leagueId]);

  const shown = rows.slice(0, visible);
  const remaining = rows.length - shown.length;
  const league = STANDINGS_COMPETITIONS.find((l) => l.id === leagueId);
  const leader = !loading ? rows[0] : undefined;
  const mostPlayed = rows.reduce((m, r) => Math.max(m, r.all.played), 0);
  const moreButton = "w-full rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-sm font-bold text-gray-200 transition hover:border-brand hover:text-brand";

  return (
    <div className="space-y-6">
      <CategoryMasthead
        kicker="League tables"
        title="Standings"
        blurb={league ? `${league.name}${league.country !== "World" ? ` (${league.country})` : ""} — the current table, refreshed from the live feed.` : "Current league tables across the competitions we cover."}
        stats={
          leader
            ? [
                { label: "Leader", value: leader.team.name, accent: true },
                { label: "Points", value: String(leader.points) },
                { label: "Teams", value: String(rows.length) },
                { label: "Most played", value: String(mostPlayed) },
              ]
            : []
        }
        actions={
          /* Native <select>, deliberately: on a phone this opens the OS picker,
             which handles a 36-league grouped list better than anything we'd
             build — it's scrollable, searchable by keypress, and accessible for
             free. appearance-none removes the browser chrome, and the brand
             tokens, focus ring and our own chevron replace it, so it reads as
             ours while staying a real select. */
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
          picker — rather than under the table at the foot of the page. */}
      <AdHalfBanner />

      {loading && <div className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm text-gray-400">Loading…</div>}

      {!loading && rows.length > 0 && (
        <>
          {/* The stats scroll sideways INSIDE this container — the page itself
              never scrolls horizontally. A league table's whole purpose is
              comparing teams down a column, which a card-per-team layout
              destroys, so the table stays a table and the position/club cell
              is pinned left instead: scroll to GF and you can still see whose
              row you're reading. */}
          <div className="overflow-x-auto rounded-3xl border border-brand-border bg-brand-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-brand-border text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-brand-card px-4 py-3">
                    Team
                  </th>
                  {STAT_COLUMNS.map((c) => (
                    <th scope="col" key={c.key} className="px-2 py-3 text-right">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-3 text-right">Pts</th>
                  <th scope="col" className="px-4 py-3">Form</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {shown.map((r) => (
                  <tr key={r.rank}>
                    {/* Rank and club share the pinned cell — two sticky columns
                        would need hard-coded offsets, and they read as one
                        thing anyway. */}
                    <th scope="row" className="sticky left-0 z-10 bg-brand-card px-4 py-3 text-left font-normal">
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-gray-500">{r.rank}</span>
                        {r.team.logo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.team.logo} alt="" width={20} height={20} loading="lazy" className="shrink-0 object-contain" />
                        )}
                        <span className="whitespace-nowrap font-bold text-gray-100">{r.team.name}</span>
                      </div>
                    </th>
                    {STAT_COLUMNS.map((c) => (
                      <td key={c.key} className="px-2 py-3 text-right tabular-nums text-gray-300">
                        {c.value(r)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right text-base font-black tabular-nums text-gray-100">{r.points}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex gap-1 text-[11px] font-black">
                        {(r.form || "").split("").map((ch, i) => (
                          <span key={i} className={FORM_TONE[ch] ?? "text-gray-500"}>
                            {ch}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Same control the fixtures lists and league standings panel use. */}
          {remaining > 0 && (
            <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)} className={moreButton}>
              Show more ({remaining} more)
            </button>
          )}
          {visible > PAGE_SIZE && (
            <button type="button" onClick={() => setVisible(PAGE_SIZE)} className={moreButton}>
              Show less
            </button>
          )}
        </>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-3xl border border-brand-border bg-brand-card p-6 text-sm text-gray-400">No standings available (check API key).</div>
      )}
    </div>
  );
}
