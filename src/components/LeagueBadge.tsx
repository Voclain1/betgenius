"use client";
import { getLeagueVisual, normalizeLeagueName } from "@/lib/leagues";

export function LeagueBadge({
  leagueApiId,
  leagueName,
  showName = true,
  size = 18,
}: {
  leagueApiId?: number | null;
  leagueName?: string | null;
  showName?: boolean;
  size?: number;
}) {
  const visual = getLeagueVisual(leagueApiId);
  // Safety net for legacy rows only. New generation rejects placeholders
  // before persistence and queued work carries the provider name.
  const name = normalizeLeagueName(leagueName) ?? visual?.name;

  if (!visual) {
    return name ? <span className="text-xs text-gray-400">{name}</span> : <span className="text-xs text-gray-600">—</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5" title={visual.name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={visual.src}
        alt={visual.name}
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-sm object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      {showName && <span className="text-xs text-gray-400">{name}</span>}
    </span>
  );
}
