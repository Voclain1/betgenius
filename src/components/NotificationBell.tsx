"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

/** Fired after notifications are marked read, so the bell drops its count without a reload. */
const READ_EVENT = "betgenius:notifications-read";

export function NotificationBell() {
  const { status } = useSession();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    const refresh = () =>
      fetch("/api/notifications?countOnly=1")
        .then((r) => (r.ok ? r.json() : null))
        .then((x) => { if (active && x) setCount(x.unread ?? 0); })
        .catch(() => {});
    refresh();
    window.addEventListener(READ_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(READ_EVENT, refresh);
    };
  }, [status, pathname]);

  if (status !== "authenticated") return null;
  return (
    <Link href="/notifications" aria-label={`${count} unread notifications`} className="relative rounded-md p-2 text-gray-300 hover:bg-brand-card">
      <Bell size={20} />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-bold text-black">
          {Math.min(count, 99)}
        </span>
      )}
    </Link>
  );
}

/** Marks the notifications a page displayed as read, then updates the bell. */
export function MarkNotificationsRead({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: key.split(",") }),
    })
      .then((r) => { if (r.ok) window.dispatchEvent(new Event(READ_EVENT)); })
      .catch(() => {});
  }, [key]);
  return null;
}
