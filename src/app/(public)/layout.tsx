import { BackButton } from "@/components/BackButton";
import { Nav } from "@/components/Nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {/* Top-left of the content column rather than in the nav bar: the back
          button belongs to the page you are on, not to the site chrome, and
          it reads that way sitting directly above the page heading. It shares
          the main padding box, so it lines up with the h1 below it.

          Renders nothing on root pages and above md, and it is the margin's
          owner (mb-3 lives on the button, not on a wrapper here), so on every
          page without a back button this contributes no element and no
          space — the heading sits exactly where it always did. */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <BackButton />
        {children}
      </main>
      <footer className="border-t border-brand-border py-8 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} BetGenius. 18+. Please bet responsibly.
      </footer>
    </>
  );
}
