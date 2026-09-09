import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "StatsPad — Team Form & Stats",
  description: "Team form, top attack and defence, goal difference leaders and over/under trends by league.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /statspad competes with the page itself.
  alternates: { canonical: "/statspad" },
};

export default function StatsPadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
