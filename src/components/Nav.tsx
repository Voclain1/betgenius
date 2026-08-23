"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ChevronDown, Menu, X } from "lucide-react";
import { SearchBox } from "@/components/SearchBox";

type NavLink = { href: string; label: string; pill?: string };

/**
 * Three groups, in priority order, replacing what was a flat row of 13 links.
 *
 * TIPS is the product — six categories that were competing for space with
 * utility pages, now behind one trigger that names what the site is for.
 * PRIMARY is what stays visible beside it. SECONDARY is real but supporting:
 * scores and tables are reference material, not the reason to visit.
 *
 * /combos is deliberately absent: the page has no content yet, and a nav slot
 * is too expensive to spend on an empty destination. The route still exists
 * and still resolves — this only stops advertising it.
 */
const TIP_LINKS: NavLink[] = [
  { href: "/predictions/today", label: "Today" },
  { href: "/predictions/genius", label: "Genius" },
  { href: "/predictions/featured", label: "Featured" },
  { href: "/predictions/banker", label: "Banker" },
  { href: "/predictions/vip", label: "VIP", pill: "vip" },
  { href: "/predictions/premium", label: "Premium", pill: "premium" },
];

const PRIMARY_LINKS: NavLink[] = [
  { href: "/bet-builder", label: "Bet Builder" },
  { href: "/combos", label: "Combos" },
  { href: "/track-record", label: "Track Record" },
];

const SECONDARY_LINKS: NavLink[] = [
  { href: "/livescores", label: "Livescores" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/standings", label: "Standings" },
  { href: "/statspad", label: "StatsPad" },
];

function NavPill({ pill }: { pill?: string }) {
  if (pill === "vip") return <span className="ml-1 text-vip">★</span>;
  if (pill === "premium") return <span className="ml-1 text-premium">◆</span>;
  return null;
}

/**
 * Desktop dropdown. Click to open rather than hover: hover menus have no
 * touch equivalent, and this same bar is what a tablet at md gets.
 */
function NavDropdown({ label, items }: { label: string; items: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-brand-card"
      >
        {label}
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[11rem] rounded-lg border border-brand-border bg-brand-bg p-1 shadow-xl">
          {items.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex items-center rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-card"
            >
              {l.label}
              <NavPill pill={l.pill} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
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
          {/* No overflow-x-auto any more: four items fit, and a scroll
              container would clip the absolutely-positioned dropdowns. */}
          <nav className="hidden items-center gap-1 md:flex">
            <NavDropdown label="Tips" items={TIP_LINKS} />
            {PRIMARY_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-brand-card">
                {l.label}
              </Link>
            ))}
            <NavDropdown label="More" items={SECONDARY_LINKS} />
          </nav>

          {/* Auth actions live in the top bar on desktop only — on mobile they
              were overflowing the viewport with no hamburger to fall back on
              (the bug this component fixes), so below md they move into the
              drawer instead, alongside the nav links. */}
          {/* Desktop search sits between the links and the auth actions. The
              link row already scrolls horizontally (overflow-x-auto), so the
              search box is given a fixed basis instead of flexing, keeping the
              bar from growing past the viewport. */}
          <div className="hidden md:block">
            <SearchBox />
          </div>

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
            <div className="mb-3">
              <SearchBox onNavigate={() => setOpen(false)} />
            </div>

            {/* Same three groups as the desktop bar. Tips uses <details>,
                the disclosure pattern already in the app (admin combo
                builder), which brings keyboard and screen-reader behaviour
                with it rather than reimplementing them here. Open by default:
                it's the primary group, and a drawer that opens onto a single
                collapsed row would hide the whole product. */}
            <nav className="flex flex-col gap-1">
              <details open className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-gray-200 hover:bg-brand-card [&::-webkit-details-marker]:hidden">
                  Tips
                  <ChevronDown size={16} className="transition group-open:rotate-180" />
                </summary>
                <div className="mt-1 flex flex-col gap-1 border-l border-brand-border pl-3">
                  {TIP_LINKS.map((l) => (
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
                </div>
              </details>

              {PRIMARY_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm font-medium text-gray-200 hover:bg-brand-card"
                >
                  {l.label}
                </Link>
              ))}

              <div className="my-2 border-t border-brand-border" />

              {SECONDARY_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-gray-400 hover:bg-brand-card"
                >
                  {l.label}
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
