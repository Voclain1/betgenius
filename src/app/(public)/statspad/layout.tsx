import type { Metadata } from "next";
import { AdLeaderboard } from "@/components/ads/AdPlacements";

export const metadata: Metadata = {
  title: "StatsPad — Team Form & Stats",
  description: "Team form, top attack and defence, goal difference leaders and over/under trends by league.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /statspad competes with the page itself.
  alternates: { canonical: "/statspad" },
};

export default function StatsPadLayout({ children }: { children: React.ReactNode }) {
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
