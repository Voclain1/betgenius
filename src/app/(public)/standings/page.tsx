"use client";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { LEAGUE_CATALOGUE, LEAGUE_TIER_LABELS } from "@/lib/leagues";

const LEAGUE_TIERS = Array.from(new Set(LEAGUE_CATALOGUE.map((l) => l.tier))).map((tier) => ({
  tier,
  label: LEAGUE_TIER_LABELS[tier] ?? tier,
  leagues: LEAGUE_CATALOGUE.filter((l) => l.tier === tier),
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

  return (
    <div className="space-y-4">
      {/* Stacked on mobile so the select gets the full width rather than
          being squeezed beside the heading; side-by-side from sm up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Standings</h1>

        {/* Native <select>, deliberately: on a phone this opens the OS picker,
            which handles a 36-league grouped list better than anything we'd
            build — it's scrollable, searchable by keypress, and accessible for
            free. What was wrong wasn't the element, it was that it kept the
            browser's default chrome. appearance-none removes that, and the
            brand tokens, focus ring and our own chevron replace it, so it
            reads as ours while staying a real select. */}
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">League</span>
          <select
            value={leagueId}
            onChange={(e) => setLeagueId(Number(e.target.value))}
            className="w-full appearance-none rounded-lg border border-brand-border bg-brand-card py-2.5 pl-3 pr-10 text-sm font-medium text-gray-100 transition hover:border-brand/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
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
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand"
          />
        </label>
      </div>

      {loading && <div className="card text-gray-400">Loading…</div>}

      {!loading && rows.length > 0 && (
        <>
          {/* The stats scroll sideways INSIDE this container — the page itself
              never scrolls horizontally. A league table's whole purpose is
              comparing teams down a column, which a card-per-team layout
              destroys, so the table stays a table and the position/club cell
              is pinned left instead: scroll to GF and you can still see whose
              row you're reading. */}
          <div className="overflow-x-auto rounded-xl border border-brand-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-brand-card text-left text-xs uppercase text-gray-400">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-brand-card px-3 py-2">
                    Team
                  </th>
                  {STAT_COLUMNS.map((c) => (
                    <th scope="col" key={c.key} className="px-2 py-2 text-right">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right">Pts</th>
                  <th scope="col" className="px-3 py-2">Form</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {shown.map((r) => (
                  <tr key={r.rank}>
                    {/* Rank and club share the pinned cell — two sticky columns
                        would need hard-coded offsets, and they read as one
                        thing anyway. */}
                    <th scope="row" className="sticky left-0 z-10 bg-brand-bg px-3 py-2 text-left font-normal">
                      <div className="flex items-center gap-2">
                        <span className="w-4 shrink-0 text-right text-xs tabular-nums text-gray-500">{r.rank}</span>
                        {r.team.logo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.team.logo} alt="" width={18} height={18} loading="lazy" className="shrink-0 object-contain" />
                        )}
                        <span className="whitespace-nowrap font-medium">{r.team.name}</span>
                      </div>
                    </th>
                    {STAT_COLUMNS.map((c) => (
                      <td key={c.key} className="px-2 py-2 text-right tabular-nums text-gray-300">
                        {c.value(r)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand">{r.points}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-400">{r.form || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Same control the fixtures lists and league standings panel use. */}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="btn btn-ghost w-full justify-center text-sm"
            >
              Show more ({remaining} more)
            </button>
          )}
          {visible > PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setVisible(PAGE_SIZE)}
              className="btn btn-ghost w-full justify-center text-sm"
            >
              Show less
            </button>
          )}
        </>
      )}

      {!loading && rows.length === 0 && (
        <div className="card text-gray-400">No standings available (check API key).</div>
      )}
    </div>
  );
}
