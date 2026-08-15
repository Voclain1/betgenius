import Link from "next/link";
import type { FixtureRow } from "@/lib/football/api-football";
import { classifyStatus, isIrregular, statusLabel, type MatchStatusGroup } from "@/lib/matchStatus";
import { matchKey } from "@/lib/slug";

/**
 * matchKey → match-page slug for fixtures that have published predictions, as
 * built by getPublishedMatchIndex(). Rows in it link to their match page; rows
 * absent from it stay plain text, since most of any day's slate has no
 * prediction and a link to an empty page is worse than no link.
 */
export type MatchLinkIndex = Record<string, string>;

function matchHref(fx: FixtureRow, index?: MatchLinkIndex): string | null {
  if (!index) return null;
  const key = matchKey({ homeTeamApiId: fx.teams.home.id, awayTeamApiId: fx.teams.away.id, kickoff: fx.fixture.date });
  const slug = key ? index[key] : null;
  return slug ? `/predictions/match/${slug}` : null;
}

/** The one deliberate "signature" moment — a two-layer pulse (ring + solid dot), not just text saying "LIVE". */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );
}

function MatchStatusCell({ fixture }: { fixture: FixtureRow }) {
  const code = fixture.fixture.status.short;
  const group = classifyStatus(code);

  if (group === "live") {
    return (
      <div className="flex items-center gap-1.5 text-red-400">
        <LiveDot />
        <span className="text-xs font-bold tabular-nums">
          {fixture.fixture.status.elapsed != null ? `${fixture.fixture.status.elapsed}'` : statusLabel(code)}
        </span>
      </div>
    );
  }
  if (isIrregular(code)) {
    return <span className="chip whitespace-nowrap bg-amber-500/20 text-[10px] text-amber-400">{statusLabel(code)}</span>;
  }
  if (group === "finished") {
    return <span className="chip whitespace-nowrap bg-gray-500/20 text-[10px] text-gray-400">{statusLabel(code)}</span>;
  }
  return (
    <span className="text-xs text-gray-400">
      {new Date(fixture.fixture.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function TeamLine({ name, logo }: { name: string; logo?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          width={18}
          height={18}
          loading="lazy"
          className="h-[18px] w-[18px] shrink-0 rounded-sm object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <span className="truncate text-sm text-gray-200">{name}</span>
    </div>
  );
}

export function MatchRow({ fx, linkIndex }: { fx: FixtureRow; linkIndex?: MatchLinkIndex }) {
  const group = classifyStatus(fx.fixture.status.short);
  const showScore = group !== "upcoming";
  const scoreTone = group === "live" ? "text-white" : "text-gray-200";
  const href = matchHref(fx, linkIndex);

  const teams = (
    <div className="min-w-0 space-y-1.5">
      <TeamLine name={fx.teams.home.name} logo={fx.teams.home.logo} />
      <TeamLine name={fx.teams.away.name} logo={fx.teams.away.logo} />
    </div>
  );

  return (
    <div className="grid grid-cols-[1fr,auto,4.5rem] items-center gap-2 px-3 py-2.5 sm:gap-3">
      {href ? (
        <Link href={href} className="min-w-0 rounded hover:opacity-80">
          {teams}
        </Link>
      ) : (
        teams
      )}
      <div className="space-y-1.5 text-right tabular-nums">
        <div className={`text-base font-bold ${scoreTone}`}>{showScore ? fx.goals.home ?? "-" : " "}</div>
        <div className={`text-base font-bold ${scoreTone}`}>{showScore ? fx.goals.away ?? "-" : " "}</div>
      </div>
      <div className="flex justify-end">
        <MatchStatusCell fixture={fx} />
      </div>
    </div>
  );
}

export function LeagueGroup({
  league,
  rows,
  linkIndex,
}: {
  league: { name: string; country: string; logo?: string };
  rows: FixtureRow[];
  linkIndex?: MatchLinkIndex;
}) {
  return (
    <section>
      <div className="sticky top-16 z-10 flex items-center gap-2 rounded-t-xl border border-b-0 border-brand-border bg-brand-card px-3 py-2">
        {league.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={league.logo}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            className="h-4 w-4 shrink-0 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-300">
          {league.country} · {league.name}
        </span>
      </div>
      <div className="divide-y divide-brand-border rounded-b-xl border border-brand-border bg-brand-bg/60">
        {rows.map((fx) => (
          <MatchRow key={fx.fixture.id} fx={fx} linkIndex={linkIndex} />
        ))}
      </div>
    </section>
  );
}

/** Groups fixtures by league, preserving each group's first-seen order (keeps whatever order the API returned, usually kickoff-ordered). */
export function groupByLeague(rows: FixtureRow[]): { league: FixtureRow["league"]; rows: FixtureRow[] }[] {
  const order: number[] = [];
  const byId = new Map<number, { league: FixtureRow["league"]; rows: FixtureRow[] }>();
  for (const r of rows) {
    const id = r.league.id;
    if (!byId.has(id)) {
      byId.set(id, { league: r.league, rows: [] });
      order.push(id);
    }
    byId.get(id)!.rows.push(r);
  }
  return order.map((id) => byId.get(id)!);
}

const TAB_ORDER: { key: MatchStatusGroup; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "upcoming", label: "Upcoming" },
  { key: "finished", label: "Finished" },
];

export function StatusTabs({
  active,
  onChange,
  counts,
}: {
  active: MatchStatusGroup;
  onChange: (group: MatchStatusGroup) => void;
  counts: Record<MatchStatusGroup, number>;
}) {
  return (
    <div className="inline-flex rounded-lg border border-brand-border bg-brand-card p-1">
      {TAB_ORDER.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            active === t.key ? "bg-brand text-black" : "text-gray-400 hover:text-white"
          }`}
        >
          {t.label} <span className="tabular-nums opacity-70">({counts[t.key]})</span>
        </button>
      ))}
    </div>
  );
}

export type LeagueScope = "major" | "all";

/** Same pill styling as StatusTabs, kept as a separate control since it's a different axis (which leagues) from status (which matches). */
export function LeagueScopeToggle({ scope, onChange }: { scope: LeagueScope; onChange: (scope: LeagueScope) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-brand-border bg-brand-card p-1">
      {(
        [
          { key: "major", label: "Major Leagues" },
          { key: "all", label: "All Leagues" },
        ] as const
      ).map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            scope === s.key ? "bg-brand text-black" : "text-gray-400 hover:text-white"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders league groups with a "show more" reveal once there are more groups
 * than `pageSize` — a group-level page (never splits a league's matches
 * across a boundary) rather than row-level pagination or virtualization.
 * State lives in the caller so this stays a plain presentational component.
 */
export function GroupedMatches({
  groups,
  visibleCount,
  onShowMore,
  pageSize = 10,
  linkIndex,
}: {
  groups: { league: FixtureRow["league"]; rows: FixtureRow[] }[];
  visibleCount: number;
  onShowMore: () => void;
  pageSize?: number;
  linkIndex?: MatchLinkIndex;
}) {
  const visible = groups.slice(0, visibleCount);
  const remaining = groups.length - visible.length;
  return (
    <div className="space-y-4">
      {visible.map((g) => (
        <LeagueGroup key={g.league.id} league={g.league} rows={g.rows} linkIndex={linkIndex} />
      ))}
      {remaining > 0 && (
        <button type="button" onClick={onShowMore} className="btn btn-ghost w-full justify-center text-sm">
          Show {Math.min(remaining, pageSize)} more leagues ({remaining} remaining)
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="card text-gray-400">{children}</div>;
}
