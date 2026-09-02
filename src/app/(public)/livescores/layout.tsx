import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Football Livescores",
  description: "Live, in-play football scores updated in real time across every major league.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /livescores competes with the page itself.
  alternates: { canonical: "/livescores" },
};

export default function LivescoresLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
