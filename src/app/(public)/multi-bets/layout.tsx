import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Multi Bets",
  description: "Multi bet accumulators spanning several fixtures, each leg taken from our published football tips.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /multi-bets competes with the page itself.
  alternates: { canonical: "/multi-bets" },
};

export default function MultiBetsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
