"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Menu, X } from "lucide-react";

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

function NavPill({ pill }: { pill?: string }) {
  if (pill === "vip") return <span className="ml-1 text-vip">★</span>;
  if (pill === "premium") return <span className="ml-1 text-premium">◆</span>;
  return null;
}

// Shared between the desktop top-bar and the mobile drawer so the two never
// drift out of sync. `onNavigate` closes the drawer on click; undefined on desktop.
function AuthActions({ isAdmin, user, onNavigate, className }: { isAdmin: boolean; user: unknown; onNavigate?: () => void; className: string }) {
  return (
    <div className={className}>
      {user ? (
        <>
          {isAdmin && (
            <Link href="/admin" onClick={onNavigate} className="btn btn-ghost text-sm">Admin</Link>
          )}
          <Link href="/dashboard" onClick={onNavigate} className="btn btn-ghost text-sm">Account</Link>
          <button
            className="btn btn-ghost text-sm"
            onClick={() => {
              onNavigate?.();
              signOut();
            }}
          >
            Log out
          </button>
        </>
      ) : (
        <>
          <Link href="/login" onClick={onNavigate} className="btn btn-ghost text-sm">Log in</Link>
          <Link href="/register" onClick={onNavigate} className="btn btn-primary text-sm">Join</Link>
        </>
      )}
    </div>
  );
}

export function Nav() {
  const { data } = useSession();
  const user = data?.user as any;
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Route change (link click, back/forward, programmatic nav) always closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it too, and background scroll is locked while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-brand-border bg-black/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-xl font-bold tracking-tight">
            <span className="text-brand">Bet</span>Genius
          </Link>
          <nav className="hidden gap-1 md:flex overflow-x-auto">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-brand-card">
                {l.label}
                <NavPill pill={l.pill} />
              </Link>
            ))}
          </nav>

          {/* Auth actions live in the top bar on desktop only — on mobile they
              were overflowing the viewport with no hamburger to fall back on
              (the bug this component fixes), so below md they move into the
              drawer instead, alongside the nav links. */}
          <AuthActions isAdmin={isAdmin} user={user} className="hidden items-center gap-2 md:flex" />

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav-drawer"
            onClick={() => setOpen((v) => !v)}
            className="btn btn-ghost p-2 md:hidden"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Rendered as a sibling of <header>, not a child — <header> has
          backdrop-blur (backdrop-filter), which establishes a new containing
          block for `position: fixed` descendants per the CSS spec. Nested
          inside <header>, this overlay was being sized/positioned relative
          to the ~62px header bar instead of the viewport. */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <div id="mobile-nav-drawer" className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-l border-brand-border bg-brand-bg p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-bold">
                <span className="text-brand">Bet</span>Genius
              </span>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="btn btn-ghost p-2">
                <X size={20} />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-card"
                >
                  {l.label}
                  <NavPill pill={l.pill} />
                </Link>
              ))}
            </nav>
            <AuthActions isAdmin={isAdmin} user={user} onNavigate={() => setOpen(false)} className="mt-4 flex flex-col gap-2 border-t border-brand-border pt-4" />
          </div>
        </div>
      )}
    </>
  );
}
