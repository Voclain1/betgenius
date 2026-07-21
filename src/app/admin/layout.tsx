import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const items = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/ai", label: "AI panel" },
  { href: "/admin/predictions", label: "Predictions" },
  { href: "/admin/subscribers", label: "Subscribers" },
  { href: "/admin/admins", label: "Admins" },
  { href: "/admin/tasks", label: "Tasks" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (!isAdmin(session.user.role)) redirect("/");

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="border-r border-brand-border bg-brand-card p-4">
        <Link href="/" className="mb-6 block text-xl font-bold">
          <span className="text-brand">Bet</span>Genius <span className="text-xs text-gray-400">admin</span>
        </Link>
        <nav className="space-y-1">
          {items.map((i) => (
            <Link key={i.href} href={i.href}
              className="block rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-bg">
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 text-xs text-gray-500">
          Signed in as<br />
          <span className="text-gray-300">{session.user.email}</span><br />
          <span className="chip mt-1 bg-brand/20 text-brand">{session.user.role}</span>
        </div>
      </aside>
      <main className="p-6">{children}</main>
    </div>
  );
}
