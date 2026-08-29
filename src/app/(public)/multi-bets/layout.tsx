import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Multi Bets",
  description: "Multi bet accumulators spanning several fixtures, each leg taken from our published football tips.",
};

export default function MultiBetsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
