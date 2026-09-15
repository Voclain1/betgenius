import type { Metadata } from "next";

export const metadata: Metadata = {
  // "Multi Bet", singular, because that is the term: the page was correctly
  // NAMED (/multi-bets) but its <title> read "Multi Bets", so the exact phrase
  // appeared nowhere in the title at all. The description already led with it.
  title: "Multi Bet Predictions",
  description: "Multi bet predictions spanning several fixtures — every leg is taken from a football tip we have already published, with its market and pick shown in full.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /multi-bets competes with the page itself.
  alternates: { canonical: "/multi-bets" },
};

export default function MultiBetsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
