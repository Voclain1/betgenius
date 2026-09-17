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
}: {
  targetType: FollowTargetType;
  targetKey: string;
  label?: string;
  /** Names what is being followed, for pages that render several buttons side by side. */
  subject?: string;
  compact?: boolean;
  /** Known server-side (e.g. on /following); skips the lookup. */
  initiallyFollowing?: boolean;
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

  if (status !== "authenticated") {
    return (
      <Link className="btn btn-ghost text-xs" href={`/login?callbackUrl=${encodeURIComponent(path)}`}>
        Follow{subject ? ` ${subject}` : compact ? "" : " this"}
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
    <button type="button" className="btn btn-ghost text-xs" disabled={pending} aria-pressed={following} title={error || undefined} onClick={toggle}>
      {pending
        ? "Saving…"
        : error
          ? "Retry"
          : following
            ? `Following${subject ? ` ${subject}` : ""} ✓`
            : `Follow${subject ? ` ${subject}` : ""}`}
    </button>
  );
}
