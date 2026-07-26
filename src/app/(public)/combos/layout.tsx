import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Combos",
  description: "Editorially curated accumulators built from our published tips, with combined odds and bookmaker links.",
};

export default function CombosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
