import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { redirect } from "next/navigation";
import { openFailureCount } from "@/lib/generationFailures";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const items = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/ai", label: "Generation panel" },
  { href: "/admin/predictions", label: "Predictions" },
  { href: "/admin/updates", label: "Prediction updates" },
  { href: "/admin/evidence-review", label: "Evidence review" },
  { href: "/admin/generation", label: "Generation" },
  { href: "/admin/failed-generations", label: "Failed generations" },
  { href: "/admin/combos", label: "Combos" },
  { href: "/admin/bookmakers", label: "Bookmakers" },
  { href: "/admin/banners", label: "Banners" },
  { href: "/admin/subscribers", label: "Subscribers" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/manual-payments", label: "Bank & USDT" },
  { href: "/admin/emails", label: "Email" },
  { href: "/admin/admins", label: "Admins" },
  { href: "/admin/jobs", label: "Scheduled jobs" },
  { href: "/admin/paid-ops", label: "Paid operations" },
  { href: "/admin/prediction-ops", label: "Prediction operations" },
  { href: "/admin/tasks", label: "Tasks" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (!isAdmin(session.user.role)) redirect("/");
  // Matches whose generation failed and still kick off ahead: shown beside the
  // link on every admin page, so a failure is seen without going looking.
  const failed = await openFailureCount();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      {/* Phones and tablets: a compact header with the menu folded away. */}
      <header className="sticky top-0 z-40 flex items-start justify-between gap-3 border-b border-brand-border bg-brand-card px-4 py-3 lg:hidden">
        <Link href="/" className="text-lg font-bold">
          <span className="text-brand">Bet</span>Genius <span className="text-xs text-gray-400">admin</span>
        </Link>
        <details className="group text-sm">
          <summary className="cursor-pointer list-none rounded-md px-3 py-1.5 text-gray-200 hover:bg-brand-bg">
            Menu{failed > 0 ? <span className="ml-1.5 font-bold tabular-nums text-red-400" aria-label={`${failed} failed generations open`}>{failed}</span> : null}
          </summary>
          <nav className="absolute inset-x-0 top-full max-h-[75vh] overflow-y-auto border-b border-brand-border bg-brand-card px-4 pb-4">
            {items.map((i) => (
              <Link key={i.href} href={i.href} className="flex items-center justify-between rounded-md px-3 py-2.5 text-gray-300 hover:bg-brand-bg">
                {i.label}
                {i.href === "/admin/failed-generations" && failed > 0 && <span className="text-xs font-bold tabular-nums text-red-400">{failed}</span>}
              </Link>
            ))}
            <p className="mt-3 px-3 text-xs text-gray-500">Signed in as {session.user.email}</p>
          </nav>
        </details>
      </header>
      <aside className="hidden border-r border-brand-border bg-brand-card p-4 lg:block">
        <Link href="/" className="mb-6 block text-xl font-bold">
          <span className="text-brand">Bet</span>Genius <span className="text-xs text-gray-400">admin</span>
        </Link>
        <nav className="space-y-1">
          {items.map((i) => (
            <Link key={i.href} href={i.href}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-bg">
              {i.label}
              {i.href === "/admin/failed-generations" && failed > 0 && (
                <span className="text-xs font-bold tabular-nums text-red-400" aria-label={`${failed} open`}>{failed}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-8 text-xs text-gray-500">
          Signed in as<br />
          <span className="text-gray-300">{session.user.email}</span><br />
          <span className="chip mt-1 bg-brand/20 text-brand">{session.user.role}</span>
        </div>
      </aside>
      <main className="min-w-0 p-4 sm:p-6">{children}</main>
    </div>
  );
}
