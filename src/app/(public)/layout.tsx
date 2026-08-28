import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <SiteFooter />
    </>
  );
}
