import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Combos",
  description: "Editorially curated selection lists built from our published football tips.",
};

export default function CombosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
