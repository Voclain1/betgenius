import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Football Livescores",
  description: "Live, in-play football scores updated in real time across every major league.",
};

export default function LivescoresLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
