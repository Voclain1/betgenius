import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Football Fixtures",
  description: "Upcoming football fixtures across every major league, with kickoff times and live status.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /fixtures competes with the page itself.
  alternates: { canonical: "/fixtures" },
};

export default function FixturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
