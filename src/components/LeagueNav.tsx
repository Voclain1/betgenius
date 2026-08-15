"use client";
import Link from "next/link";
import type { LeagueNavItem } from "@/lib/predictionScope";

/**
 * A wrapping row of league pills linking to /predictions/league/[slug]. Used
 * twice on the homepage — once for every league with published predictions,
 * once for the MAJOR_LEAGUES subset (see popularLeagues()) — so the only
 * difference between "quick nav" and "popular" is the array passed in.
 *
 * Client component purely for the crest <img> onError fallback: a crest URL
 * that 404s on api-sports' CDN collapses to the text-only pill rather than a
 * broken-image icon, matching LeagueBadge's behaviour.
 */
export function LeagueNav({ leagues, empty }: { leagues: LeagueNavItem[]; empty: React.ReactNode }) {
  if (leagues.length === 0) return <div className="card text-sm text-gray-400">{empty}</div>;

  return (
    <div className="flex flex-wrap gap-2">
      {leagues.map((l) => (
        <Link
          key={l.slug}
          href={`/predictions/league/${l.slug}`}
          title={l.country ? `${l.name} · ${l.country}` : l.name}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand-border bg-brand-card px-3 py-1.5 text-sm transition hover:border-brand hover:text-brand"
        >
          {l.crest && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={l.crest}
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
          <span className="truncate">{l.name}</span>
          <span className="shrink-0 tabular-nums text-xs text-gray-500">{l.count}</span>
        </Link>
      ))}
    </div>
  );
}
