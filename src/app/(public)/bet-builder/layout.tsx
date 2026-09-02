import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bet Builder & Over 2.5 Predictions",
  description: "Combine football picks, including over 2.5 predictions, into one clear Bet Builder selection list.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /bet-builder competes with the page itself.
  alternates: { canonical: "/bet-builder" },
};

export default function BetBuilderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
