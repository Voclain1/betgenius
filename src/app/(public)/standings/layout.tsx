import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Football Standings",
  description: "Up-to-date league tables across the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and more major competitions.",
};

export default function StandingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
