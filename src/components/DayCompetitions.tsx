"use client";
import Link from "next/link";
import { competitionPredictionsHref } from "@/lib/cupConfig";
import type { DayCompetition } from "@/lib/dayCompetitions";

/**
 * The homepage's competitions for the day: a compact grid of tiles, each the
 * competition's short name (UCL, EPL, LaLiga) over how many tips it has that
 * day, opening its prediction page. Selection and order live in
 * src/lib/dayCompetitions.ts.
 *
 * Client component only for the crest <img> onError fallback, as LeagueNav.
 */
export function DayCompetitions({ items, dayWord }: { items: DayCompetition[]; dayWord: string }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((c) => (
        <li key={c.slug}>
          <Link
            href={competitionPredictionsHref(c.leagueApiId, c.slug)}
            title={c.country ? `${c.name} · ${c.country}` : c.name}
            aria-label={`${c.name} predictions${c.count != null ? `, ${c.count} ${dayWord}` : ""}`}
            className="group flex h-full items-center gap-2 rounded-2xl border border-brand-border bg-brand-card px-2.5 py-2 transition hover:border-brand sm:gap-2.5 sm:px-3 sm:py-2.5"
          >
            {c.crest && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.crest}
                alt=""
                width={20}
                height={20}
                loading="lazy"
                className="h-5 w-5 shrink-0 rounded-sm object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-black uppercase leading-tight text-gray-100 group-hover:text-brand sm:text-[13px] sm:tracking-[0.04em]">{c.short}</span>
              <span className="block truncate text-[10.5px] font-semibold text-gray-500 sm:text-[11px]">
                {c.count != null ? `${c.count} ${c.count === 1 ? "tip" : "tips"} ${dayWord}` : (c.country ?? "All tips")}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
