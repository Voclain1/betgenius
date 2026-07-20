"use client";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

const links = [
  { href: "/predictions/featured", label: "Featured" },
  { href: "/predictions/genius", label: "Genius Tips" },
  { href: "/predictions/today", label: "Today" },
  { href: "/predictions/banker", label: "Banker" },
  { href: "/predictions/vip", label: "VIP", pill: "vip" },
  { href: "/predictions/premium", label: "Premium", pill: "premium" },
  { href: "/track-record", label: "Track Record" },
  { href: "/livescores", label: "Livescores" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/standings", label: "Standings" },
  { href: "/bet-builder", label: "Bet Builder" },
  { href: "/statspad", label: "StatsPad" },
];

export function Nav() {
  const { data } = useSession();
  const user = data?.user as any;
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  return (
    <header className="sticky top-0 z-40 border-b border-brand-border bg-black/40 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-bold tracking-tight">
          <span className="text-brand">Bet</span>Genius
        </Link>
        <nav className="hidden gap-1 md:flex overflow-x-auto">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-brand-card">
              {l.label}
              {l.pill === "vip" && <span className="ml-1 text-vip">★</span>}
              {l.pill === "premium" && <span className="ml-1 text-premium">◆</span>}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              {isAdmin && (
                <Link href="/admin" className="btn btn-ghost text-sm">Admin</Link>
              )}
              <Link href="/dashboard" className="btn btn-ghost text-sm">Account</Link>
              <button className="btn btn-ghost text-sm" onClick={() => signOut()}>Log out</button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost text-sm">Log in</Link>
              <Link href="/register" className="btn btn-primary text-sm">Join</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
