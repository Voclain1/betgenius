"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type FollowTargetType = "TEAM" | "LEAGUE" | "PREDICTION" | "CATEGORY";

type Follow = { targetType: string; targetKey: string };

/**
 * One /api/follows request shared by every button on the page. A match page
 * renders three buttons and /following one per follow; each fetching the same
 * list on mount was pure duplication.
 */
let followsRequest: Promise<Follow[]> | null = null;
function loadFollows(): Promise<Follow[]> {
  followsRequest ??= fetch("/api/follows")
    .then((r) => (r.ok ? r.json() : { follows: [] }))
    .then((x) => (Array.isArray(x.follows) ? x.follows : []))
    .catch(() => {
      followsRequest = null;
      return [];
    });
  return followsRequest;
}

export function FollowButton({
  targetType,
  targetKey,
  label,
  subject,
  compact = false,
  initiallyFollowing,
  icon,
  short,
}: {
  targetType: FollowTargetType;
  targetKey: string;
  label?: string;
  /** Names what is being followed, for pages that render several buttons side by side. */
  subject?: string;
  compact?: boolean;
  /** Known server-side (e.g. on /following); skips the lookup. */
  initiallyFollowing?: boolean;
  /** Shown before the text, e.g. a team crest. */
  icon?: React.ReactNode;
  /**
   * Visible text after "Follow" in place of `subject`, for a row of small
   * buttons that must sit on one line ("" for just "Follow" beside a crest).
   * `subject` still names the target for screen readers and the tooltip.
   */
  short?: string;
}) {
  const { status } = useSession();
  const path = usePathname();
  const [following, setFollowing] = useState(initiallyFollowing ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "authenticated" || initiallyFollowing !== undefined) return;
    let active = true;
    loadFollows().then((follows) => {
      if (active) setFollowing(follows.some((f) => f.targetType === targetType && f.targetKey === targetKey));
    });
    return () => {
      active = false;
    };
  }, [status, targetType, targetKey, initiallyFollowing]);

  const shown = short !== undefined ? (short ? ` ${short}` : "") : subject ? ` ${subject}` : "";
  const cls = `btn btn-ghost text-xs${short !== undefined ? " whitespace-nowrap rounded-full px-3 py-1.5" : ""}`;
  const named = short !== undefined && subject ? { "aria-label": `Follow ${subject}` } : {};

  if (status !== "authenticated") {
    return (
      <Link className={cls} href={`/login?callbackUrl=${encodeURIComponent(path)}`} title={subject ? `Follow ${subject}` : undefined} {...named}>
        {icon}
        Follow{short !== undefined ? shown : subject ? ` ${subject}` : compact ? "" : " this"}
      </Link>
    );
  }

  const toggle = async () => {
    setPending(true);
    setError("");
    try {
      const r = await fetch("/api/follows", {
        method: following ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetKey, label }),
      });
      if (r.ok) {
        setFollowing(!following);
        followsRequest = null;
      } else {
        setError("Could not update follow");
      }
    } catch {
      setError("Could not update follow");
    } finally {
      setPending(false);
    }
  };

  return (
    <button type="button" className={cls} disabled={pending} aria-pressed={following} title={error || (subject ? `Follow ${subject}` : undefined)} onClick={toggle} {...named}>
      {icon}
      {pending
        ? "Saving…"
        : error
          ? "Retry"
          : following
            ? `Following${shown} ✓`
            : `Follow${shown}`}
    </button>
  );
}
