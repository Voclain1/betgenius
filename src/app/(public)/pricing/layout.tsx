import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — VIP & Premium Plans",
  description: "Unlock VIP and Premium football tips, AI match previews and priority support with a BetGenius subscription.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
