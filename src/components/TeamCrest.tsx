"use client";
import { useState } from "react";
import { teamCrestUrl } from "@/lib/leagues";

/**
 * A club or national-team crest, straight from API-Football's media CDN by
 * team id. Every prediction already stores both team ids, so this costs no
 * API calls and needs no cache: the URL is a pure function of the id.
 *
 * With `name`, a team always shows something in the crest's place: when the
 * row has no team id, or the CDN has no image for it, a round badge with the
 * team's initials takes the same space, so rows of tips stay aligned. Without
 * `name` it renders nothing in those cases, as before.
 */
export function TeamCrest({
  teamApiId,
  size = 18,
  className = "",
  name,
}: {
  teamApiId?: number | null;
  size?: number;
  className?: string;
  /** The team's name, for the initials badge when there is no crest image. */
  name?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const hasId = teamApiId != null && teamApiId > 0;

  if (!hasId || failed) {
    const initials = teamInitials(name);
    if (!initials) return null;
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.42)) }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-bg align-[-0.2em] font-black leading-none text-gray-400 ring-1 ring-brand-border ${className}`}
      >
        {initials}
      </span>
    );
  }

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
      onError={(e) => {
        if (name) setFailed(true);
        else (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

/** "Manchester United" → "MU", "Abha" → "AB", "1. FC Nürnberg" → "FN". Pure. */
export function teamInitials(name?: string | null): string {
  const words = (name ?? "")
    .split(/[\s.\-]+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter((w) => w.length > 0 && !/^(fc|cf|sc|ac|afc|cd|ud|sv|vfl|vfb|fk|nk|sk|if|bk)$/i.test(w));
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
