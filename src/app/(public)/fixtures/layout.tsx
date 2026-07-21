import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Football Fixtures",
  description: "Upcoming football fixtures across every major league, with kickoff times and live status.",
};

export default function FixturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
