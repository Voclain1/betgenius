import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "StatsPad — Team Form & Stats",
  description: "Team form, top attack and defence, goal difference leaders and over/under trends by league.",
};

export default function StatsPadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
