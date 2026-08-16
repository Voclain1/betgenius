"use client";
import Link from "next/link";
import { teamSlug } from "@/lib/slug";
import type { LeagueClub } from "@/lib/predictionScope";

/**
 * Every club in the league, by crest, each linking to its team page.
 *
 * Client component for the same single reason LeagueNav is one: the crest
 * <img> needs an onError fallback so a URL that 404s collapses to the text
 * initials rather than showing a broken image. Crest resolution itself happens
 * server-side in getLeagueClubs().
 */
export function LeagueClubGrid({ clubs }: { clubs: LeagueClub[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {clubs.map((c) => (
        <Link
          key={c.teamId}
          href={`/predictions/team/${teamSlug(c.teamName)}`}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-brand-border bg-brand-card p-2 text-center transition hover:border-brand"
        >
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
        </Link>
      ))}
    </div>
  );
}
