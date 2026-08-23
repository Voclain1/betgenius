import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bet Builder",
  description: "Combine multiple football picks into one clear selection list.",
};

export default function BetBuilderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
