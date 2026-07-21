import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up Free",
  description: "Create a free BetGenius account to unlock Banker tips and more.",
  robots: { index: false, follow: true },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
