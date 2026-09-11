import type { Metadata } from "next";
import { AdHalfBanner } from "@/components/ads/AdPlacements";

export const metadata: Metadata = {
  // "live score nigeria" rather than "livescore" or "live scores today". The
  // generic terms are held by ESPN, Flashscore, SofaScore and LiveScore.com at
  // difficulty 92-100 and are not winnable here on on-page work alone; the
  // geo-qualified term is. It is also accurate: the feed is API-Football's
  // `live: all`, so Nigerian football is in it, not excluded from it.
  title: "Live Score Nigeria — Today's Football Scores",
  description: "Live football scores from Nigeria and every other league we cover — in-play minutes and goals, plus today's upcoming kickoffs and finished results, grouped by competition.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /livescores competes with the page itself.
  alternates: { canonical: "/livescores" },
};

export default function LivescoresLayout({ children }: { children: React.ReactNode }) {
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
