import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bet Builder & Over 2.5 Predictions",
  description: "Combine football picks, including over 2.5 predictions, into one clear Bet Builder selection list.",
};

export default function BetBuilderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
