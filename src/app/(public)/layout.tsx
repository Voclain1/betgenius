import { Nav } from "@/components/Nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <footer className="border-t border-brand-border py-8 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} BetGenius. 18+. Please bet responsibly.
      </footer>
    </>
  );
}
