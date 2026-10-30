"use client";
import { useState } from "react";
import { leagueLogoUrl } from "@/lib/leagues";

/**
 * A competition's own crest by API-Football league id — the Premier League
 * lion, the Champions League starball — rather than the country flag
 * LeagueBadge shows for domestic leagues. Renders nothing without an id or
 * when the CDN has no image, so a row never shows a broken icon.
 */
export function CompetitionBadge({ leagueApiId, size = 14 }: { leagueApiId?: number | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (leagueApiId == null || leagueApiId <= 0 || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={leagueLogoUrl(leagueApiId)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
      className="shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  );
}
