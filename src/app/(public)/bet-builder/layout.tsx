import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bet Builder",
  description: "Combine multiple picks into an accumulator and compute your combined odds instantly.",
};

export default function BetBuilderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
