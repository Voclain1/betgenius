import type { Metadata } from "next";

export const metadata: Metadata = {
  // "Multi Bet", singular, because that is the term: the page was correctly
  // NAMED (/multi-bets) but its <title> read "Multi Bets", so the exact phrase
  // appeared nowhere in the title at all. The description already led with it.
  title: "Multi Bet Predictions",
  description: "Football multi bet predictions and accumulators from published picks. Compare combined odds, understand each leg and check which selections require membership.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /multi-bets competes with the page itself.
  alternates: { canonical: "/multi-bets" },
};

export default function MultiBetsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
