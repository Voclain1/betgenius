import type { Metadata } from "next";
import { AdHalfBanner } from "@/components/ads/AdPlacements";

export const metadata: Metadata = {
  // No keyword targeted here on purpose — the realistic difficulty on the raw
  // fixtures terms puts them out of reach for now. This is written to describe
  // the page correctly instead: it is a date-filtered list with live and
  // finished tabs, not an upcoming-only one, and it scopes from the major
  // leagues out to every competition we cover.
  title: "Football Fixtures",
  description: "Football fixtures by date, with kickoff times, live status and finished results. Filter from the major leagues out to every competition we cover; any fixture we have published a prediction on links straight to it.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /fixtures competes with the page itself.
  alternates: { canonical: "/fixtures" },
};

export default function FixturesLayout({ children }: { children: React.ReactNode }) {
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
        <AdHalfBanner />
      </div>
    </>
  );
}
