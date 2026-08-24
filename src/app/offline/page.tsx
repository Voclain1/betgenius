import type { Metadata } from "next";

/**
 * The last-resort page the service worker serves when a navigation fails and
 * nothing for that URL is in the cache.
 *
 * Outside the (public) route group on purpose: that layout's nav renders links
 * to pages that cannot load offline, and its footer is not what someone with no
 * connection needs to read. This is a standalone shell, precached by name in
 * public/sw.js.
 *
 * Static and self-contained — no data fetching, since by definition nothing can
 * be fetched when this renders.
 */
export const metadata: Metadata = {
  title: "You're offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-4">
        <div className="text-3xl font-bold">
          <span className="text-brand">Bet</span>Genius
        </div>
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="text-sm leading-relaxed text-gray-400">
          Tips, livescores and fixtures all need a connection. Reconnect and this page will pick up where you left off.
        </p>
        <p className="text-xs text-gray-500">Pages you have already opened stay available while you&apos;re offline.</p>
      </div>
    </div>
  );
}
