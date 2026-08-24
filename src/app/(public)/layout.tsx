import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      {/*
        The AI disclosure lives here, on every public page, rather than in the
        homepage headline. It was pulled out of the hero, the nav and the meta
        descriptions as a marketing claim — which is only defensible if the
        fact itself stays plainly visible, so it moved into the footer and onto
        /methodology instead of being dropped.
      */}
      <footer className="border-t border-brand-border py-8 text-center text-xs text-gray-500">
        <p>
          Predictions are AI-generated from live match data and reviewed by our team before publication.{" "}
          <Link href="/methodology" className="underline hover:text-gray-300">
            How our predictions are made
          </Link>
        </p>
        <p className="mt-2">© {new Date().getFullYear()} BetGenius. 18+. Please bet responsibly.</p>
      </footer>
    </>
  );
}
