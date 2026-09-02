import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — VIP & Premium Plans",
  description: "Unlock VIP and Premium football tips, in-depth match previews and priority support with a BetGenius subscription.",
  // Self-canonical. Without it the page has no canonical at all, so any
  // parameterised or proxied variant of /pricing competes with the page itself.
  alternates: { canonical: "/pricing" },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
