"use client";
import { teamCrestUrl } from "@/lib/leagues";

/**
 * A club or national-team crest, straight from API-Football's media CDN by
 * team id. Every prediction already stores both team ids, so this costs no
 * API calls and needs no cache: the URL is a pure function of the id.
 *
 * Renders nothing without an id, and hides itself if the image 404s, so a
 * team API-Football has no crest for falls back to the bare name rather than
 * a broken-image icon.
 */
export function TeamCrest({ teamApiId, size = 18, className = "" }: { teamApiId?: number | null; size?: number; className?: string }) {
  if (teamApiId == null || teamApiId <= 0) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={teamCrestUrl(teamApiId)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 object-contain align-[-0.2em] ${className}`}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}
