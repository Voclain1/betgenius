import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Football Standings",
  description: "Up-to-date league tables across the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and more major competitions.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /standings competes with the page itself.
  alternates: { canonical: "/standings" },
};

export default function StandingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
