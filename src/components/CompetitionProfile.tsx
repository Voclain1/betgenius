import { ChevronDown } from "lucide-react";
import { TeamCrest } from "@/components/TeamCrest";
import { NextMatchCard, RankedList } from "@/components/TeamProfile";
import { leagueLogoUrl } from "@/lib/leagues";
import { titlesSince, type Champion } from "@/lib/competitionHistory";
import type { CompetitionStats } from "@/lib/competitionProfile";
import type { TeamNextMatch } from "@/lib/teamProfile";
import type { LeaguePlayerStat } from "@/lib/enrichment";

/**
 * League and cup page pieces in the team pages' visual language: the same
 * masthead treatment, matchup cards, ranked boards and gold for honours.
 * Server components; crest and badge images are the only client parts.
 */

export function CompetitionMasthead({
  name,
  leagueApiId,
  country,
  flagCode,
  seasonLabel,
  stats,
  children,
}: {
  name: string;
  leagueApiId: number | null;
  country: string | null;
  flagCode: string | null;
  seasonLabel: string | null;
  stats: CompetitionStats | null;
  /** Follow button and anything else under the name. */
  children?: React.ReactNode;
}) {
  return (
    <header className="relative overflow-hidden rounded-3xl border border-brand-border bg-brand-card shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
      {leagueApiId != null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          aria-hidden
          src={leagueLogoUrl(leagueApiId)}
          alt=""
          className="pointer-events-none absolute -right-10 -top-8 h-56 w-56 select-none object-contain opacity-[0.07] sm:h-72 sm:w-72"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.18),transparent)]" />

      <div className="relative flex items-center gap-4 p-5 sm:gap-6 sm:p-8">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white shadow-inner ring-1 ring-brand-border sm:h-28 sm:w-28">
          {leagueApiId != null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={leagueLogoUrl(leagueApiId)} alt="" width={64} height={64} className="h-14 w-14 object-contain sm:h-20 sm:w-20" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {country && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-bg/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
                {flagCode && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`https://media.api-sports.io/flags/${flagCode}.svg`} alt="" width={16} height={12} className="rounded-[2px] object-cover" />
                )}
                {country}
              </span>
            )}
            {seasonLabel && <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Season {seasonLabel}</span>}
          </div>
          <h1 className="text-3xl font-black leading-[1.05] tracking-tight text-gray-100 sm:text-5xl">{name}</h1>
          {children}
        </div>
      </div>

      {stats && (
        <div className="relative border-t border-brand-border bg-brand-bg/40">
          <dl className="grid grid-cols-4 divide-x divide-brand-border text-center">
            {[
              ["Clubs", String(stats.clubs)],
              ["Matches", String(stats.matches)],
              ["Goals", String(stats.goals)],
              ["Per game", stats.goalsPerMatch.toFixed(2)],
            ].map(([label, value], i) => (
              <div key={label} className="px-1 py-3.5">
                <dd className={`text-2xl font-black tabular-nums sm:text-3xl ${i === 3 ? "text-brand" : "text-gray-100"}`}>{value}</dd>
                <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</dt>
              </div>
            ))}
          </dl>
          <div className="flex items-center justify-center gap-2 border-t border-brand-border px-3 py-2.5 text-xs">
            <span className="font-semibold text-gray-400">Leaders</span>
            <TeamCrest teamApiId={stats.leader.teamId} size={16} />
            <span className="font-bold text-gray-100">{stats.leader.teamName}</span>
            <span className="font-bold text-brand">· {stats.leader.points} pts</span>
          </div>
        </div>
      )}
    </header>
  );
}

/** Two or three marquee fixtures from the next round, as matchup cards. */
export function FeaturedMatches({ matches }: { matches: TeamNextMatch[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {matches.map((m) => (
        <NextMatchCard key={`${m.kickoff.toISOString()}-${m.homeTeam}`} match={m} />
      ))}
    </div>
  );
}

function FactTile({ label, value, sub, teamId }: { label: string; value: string; sub?: string; teamId?: number | null }) {
  return (
    <div className="rounded-2xl border border-brand-border bg-brand-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        {teamId != null && <TeamCrest teamApiId={teamId} size={22} />}
        <span className="truncate text-2xl font-black tabular-nums text-gray-100">{value}</span>
      </div>
      {sub && <div className="mt-1 text-xs font-medium leading-snug text-gray-400">{sub}</div>}
    </div>
  );
}

/** Season-so-far numbers from the live table: results split, attack, defence, wins, unbeaten. */
export function CompetitionStatsFacts({ stats }: { stats: CompetitionStats }) {
  const tiles: { label: string; value: string; sub?: string; teamId?: number | null }[] = [];
  if (stats.homeWinPct != null) {
    tiles.push({ label: "Home wins", value: `${stats.homeWinPct}%`, sub: `Draws ${stats.drawPct}% · Away wins ${stats.awayWinPct}%` });
  }
  tiles.push({ label: "Goals per game", value: stats.goalsPerMatch.toFixed(2), sub: `${stats.goals} goals in ${stats.matches} matches` });
  tiles.push({ label: "Best attack", value: String(stats.bestAttack.goalsFor), sub: stats.bestAttack.teamName, teamId: stats.bestAttack.teamId });
  tiles.push({
    label: "Best defence",
    value: String(stats.bestDefence.goalsAgainst),
    sub: `${stats.bestDefence.teamName} · conceded`,
    teamId: stats.bestDefence.teamId,
  });
  tiles.push({ label: "Most wins", value: String(stats.mostWins.win), sub: stats.mostWins.teamName, teamId: stats.mostWins.teamId });
  tiles.push({
    label: "Unbeaten",
    value: String(stats.unbeaten.length),
    sub: stats.unbeaten.length ? stats.unbeaten.slice(0, 3).map((r) => r.teamName).join(", ") : "Every club has lost at least once",
  });
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {tiles.map((t) => (
        <FactTile key={t.label} {...t} />
      ))}
    </div>
  );
}

const playerRows = (list: LeaguePlayerStat[], unit: (v: number) => string) =>
  list.slice(0, 5).map((p) => ({
    key: p.playerId,
    name: p.name,
    photo: p.photo,
    sub: `${p.teamName}${p.appearances != null ? ` · ${p.appearances} apps` : ""}`,
    value: unit(p.value),
  }));

/** The competition's leading players so far: goals, assists and (where kept) yellow cards. */
export function CompetitionTopPlayers({ scorers, assists, cards }: { scorers: LeaguePlayerStat[]; assists: LeaguePlayerStat[]; cards?: LeaguePlayerStat[] }) {
  if (!scorers.length && !assists.length && !cards?.length) {
    return <p className="text-sm text-gray-500">Player statistics for this season are not available yet.</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <RankedList title="Top scorers" rows={playerRows(scorers, String)} />
      <RankedList title="Most assists" rows={playerRows(assists, String)} />
      {cards && <RankedList title="Most yellow cards" rows={playerRows(cards, String)} />}
    </div>
  );
}

function ChampionRow({ c }: { c: Champion }) {
  const muted = c.note && !c.also;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="w-16 shrink-0 text-sm font-black tabular-nums text-gray-400">{c.season}</span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-bg ring-1 ring-brand-border">
        {c.teamId != null ? <TeamCrest teamApiId={c.teamId} size={20} /> : <span aria-hidden className="h-2 w-2 rounded-full bg-amber-300/60" />}
      </span>
      <span className={`min-w-0 flex-1 truncate text-sm font-bold ${muted ? "text-gray-500" : "text-gray-100"}`}>
        {c.winner}
        {c.also && ` & ${c.also.winner}`}
      </span>
      {c.note && <span className="shrink-0 text-[11px] text-gray-500">{c.note}</span>}
    </li>
  );
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-brand-border">
      <summary className="flex cursor-pointer list-none items-center gap-1 py-3 text-sm font-bold text-gray-100 hover:text-brand">
        {label}
        <ChevronDown size={16} aria-hidden className="transition group-open:rotate-180" />
      </summary>
      {children}
    </details>
  );
}

/**
 * The competition's whole roll of honour: the three most successful clubs of
 * all time as gold tiles, the latest ten champions, and behind native
 * disclosures (in the HTML, no client bundle) every season since the first
 * and every title-winning club with its count.
 */
export function CompetitionChampions({ champions, scope }: { champions: Champion[]; scope?: string }) {
  const asOf = champions[0]?.season;
  const first = champions[champions.length - 1]?.season;
  const tally = titlesSince(champions);
  const leaders = tally.slice(0, 3);
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-3 gap-2.5">
        {leaders.map((l) => (
          <li key={l.winner} className="rounded-2xl border border-brand-border bg-brand-card p-3 text-center">
            <div className="text-3xl font-black tabular-nums leading-none text-amber-300">{l.count}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">titles</div>
            <div className="mt-2 flex flex-col items-center gap-1.5">
              {l.teamId != null && <TeamCrest teamApiId={l.teamId} size={20} />}
              <span className="line-clamp-2 text-xs font-bold leading-snug text-gray-100">{l.winner}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="rounded-3xl border border-brand-border bg-brand-card px-4 py-1">
        <div className="pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Latest champions</div>
        <ul className="divide-y divide-brand-border">
          {champions.slice(0, 10).map((c) => (
            <ChampionRow key={c.season} c={c} />
          ))}
        </ul>
        {champions.length > 10 && (
          <Disclosure label={`Every season since ${first}`}>
            <ul className="divide-y divide-brand-border border-t border-brand-border">
              {champions.slice(10).map((c) => (
                <ChampionRow key={c.season} c={c} />
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure label={`All ${tally.length} title-winning clubs`}>
          <ol className="divide-y divide-brand-border border-t border-brand-border">
            {tally.map((t) => (
              <li key={t.winner} className="flex items-center gap-3 py-2.5">
                <span className="w-8 shrink-0 text-right text-lg font-black tabular-nums text-amber-300">{t.count}</span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-bg ring-1 ring-brand-border">
                  {t.teamId != null ? <TeamCrest teamApiId={t.teamId} size={20} /> : <span aria-hidden className="h-2 w-2 rounded-full bg-amber-300/60" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-100">{t.winner}</span>
                <span className="shrink-0 text-xs font-medium text-gray-500">Last {t.last}</span>
              </li>
            ))}
          </ol>
        </Disclosure>
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500">
        {scope ? `${scope} ` : ""}Up to the end of the {asOf} season.
      </p>
    </div>
  );
}
