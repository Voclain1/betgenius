"use client";
import Link from "next/link";
import type { LeagueClub } from "@/lib/predictionScope";

/**
 * Every club in the league, by crest, linking to the team pages that exist.
 *
 * A club with no published prediction renders as a plain tile: its team page
 * is noindex and empty (see getPublishedTeamIndex), and a link into it is
 * worse than no link for the reader and for crawl budget alike. The grid still
 * lists the whole league — it describes the competition, not our coverage.
 *
 * Client component for the same single reason LeagueNav is one: the crest
 * <img> needs an onError fallback so a URL that 404s collapses to the text
 * initials rather than showing a broken image. Crest resolution and slug
 * resolution both happen server-side in getLeagueClubs().
 */
export function LeagueClubGrid({ clubs }: { clubs: LeagueClub[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {clubs.map((c) => {
        const tile = (
          <>
            {c.crest ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.crest}
                alt=""
                width={28}
                height={28}
                loading="lazy"
                className="h-7 w-7 shrink-0 object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-bg text-[10px] font-semibold text-gray-400">
                {c.teamName.slice(0, 3).toUpperCase()}
              </span>
            )}
            <span className="line-clamp-2 text-[11px] leading-tight text-gray-300">{c.teamName}</span>
          </>
        );
        const base = "flex flex-col items-center gap-1.5 rounded-lg border border-brand-border bg-brand-card p-2 text-center";
        return c.slug ? (
          <Link key={c.teamId} href={`/predictions/team/${c.slug}`} className={`${base} transition hover:border-brand`}>
            {tile}
          </Link>
        ) : (
          <div key={c.teamId} className={base}>
            {tile}
          </div>
        );
      })}
    </div>
  );
}
