import type { Metadata } from "next";
import { AdLeaderboard } from "@/components/ads/AdPlacements";

export const metadata: Metadata = {
  title: "Live Football Standings",
  description: "Up-to-date league tables across the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and more major competitions.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /standings competes with the page itself.
  alternates: { canonical: "/standings" },
};

export default function StandingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* At the foot of the page, in the layout rather than the page body,
          because the page body here is a client component that owns its own
          loading and filter state — the ad has nothing to do with any of that
          and should not re-render with it.

          These utility pages carry no predictions at all: a table of scores,
          a fixture list, a form board. There is no call of ours anywhere on
          them for an ad to be confused with, which is why they take a unit
          while the feeds get one band at most. */}
      <div className="mt-8">
        <AdLeaderboard />
      </div>
    </>
  );
}
