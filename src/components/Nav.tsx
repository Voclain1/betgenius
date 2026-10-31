"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronDown, CircleUser, Menu, Search, Smartphone, X } from "lucide-react";
// Imported for its side effect too: it starts listening for the browser's
// one-time install offer on every public page, so /app can use it later.
import "@/lib/installStore";
import { SearchBox } from "@/components/SearchBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BRAND_ICON_DARK, BRAND_ICON_LIGHT, BRAND_ICON_SIZE } from "@/lib/brandAssets";
import { NotificationBell } from "@/components/NotificationBell";
import { LogoutButton } from "@/components/LogoutButton";
import { MARKET_HUBS } from "@/lib/marketHubs";
import { lockScroll } from "@/lib/scrollLock";

/** `wideOnly`: in the bar's row from xl only; below that it is under More. */
type NavLink = { href: string; label: string; pill?: string; wideOnly?: boolean };

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
  // "Combo Bets" = two picks on ONE match. "Multi Bets" (/multi-bets, in
  // PRIMARY_LINKS) = one pick across SEVERAL matches. The two used to be
  // "Doubles" and "Combos", which shared no wording but described each other's
  // shape; the current pair splits on the word that actually differs.
  { href: "/predictions/combo-bets", label: "Combo Bets" },
  { href: "/predictions/goals", label: "Goals" },
  { href: "/predictions/vip", label: "VIP", pill: "vip" },
  { href: "/predictions/premium", label: "Premium", pill: "premium" },
];

/** Every free tip of the day in one market (src/lib/marketHubs.ts), under Tips. */
const MARKET_LINKS: NavLink[] = MARKET_HUBS.map((m) => ({ href: m.href, label: m.label }));

const PRIMARY_LINKS: NavLink[] = [
  { href: "/match-insights", label: "Insights" },
  { href: "/bet-builder", label: "Bet Builder" },
  { href: "/multi-bets", label: "Multi Bets" },
  { href: "/track-record", label: "Track Record", wideOnly: true },
];

const SECONDARY_LINKS: NavLink[] = [
  { href: "/livescores", label: "Livescores" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/standings", label: "Standings" },
  { href: "/statspad", label: "StatsPad" },
];

/**
 * The brand lockup: the pack's icon mark beside the wordmark.
 *
 * The mark is an <Image> and the wordmark is still live text. The pack does
 * ship a single-image lockup with both, but the two-part build is better here
 * regardless: the name stays selectable, searchable and readable to a screen
 * reader (so the <Image> takes alt="", it would otherwise be announced twice),
 * it stays crisp at any weight, and the row costs ~28px more than the mark
 * alone at the one breakpoint where the nav is tight.
 *
 * Height, not width, is what is fixed — `h-7 w-auto` with the intrinsic
 * dimensions passed through. The mark is very nearly square (520x530), so the
 * rendered width lands at 27px and the whole lockup at 137px, against 111px for
 * the wordmark alone. scripts/check-nav-fit.tsx measures the whole bar.
 *
 * `priority` because this is in the sticky header on every route: the mark is
 * inside the LCP viewport, and a lazily-loaded nav logo pops in after paint.
 * `sizes` is what keeps that cheap. Without it next/image sees a 520px-wide
 * source and preloads the 640px variant of BOTH colourways — a quarter of a
 * megabyte, most of it for the mark that is currently display:none. Declaring
 * the real rendered width pulls the srcset down to the 32/64px entries.
 */
function BrandLockup({ className }: { className: string }) {
  return (
    <>
      <Image
        src={BRAND_ICON_DARK}
        alt=""
        {...BRAND_ICON_SIZE}
        sizes="28px"
        priority
        className="brand-mark-dark h-7 w-auto shrink-0"
      />
      <Image
        src={BRAND_ICON_LIGHT}
        alt=""
        {...BRAND_ICON_SIZE}
        sizes="28px"
        priority
        className="brand-mark-light h-7 w-auto shrink-0"
      />
      <span className={className}>
        <span className="text-brand">Bet</span>Genius
      </span>
    </>
  );
}

function NavPill({ pill }: { pill?: string }) {
  if (pill === "vip") return <span className="ml-1 text-vip">★</span>;
  if (pill === "premium") return <span className="ml-1 text-premium">◆</span>;
  return null;
}

/** Closes a popover on a click outside `ref` or on Escape, while it is open. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/**
 * Desktop dropdown. Click to open rather than hover: hover menus have no
 * touch equivalent, and this same bar is what a tablet at md gets.
 */
function NavDropdown({ label, items, section }: { label: string; items: NavLink[]; section?: { heading: string; items: NavLink[] } }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

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
              prefetch={false}
              onClick={() => setOpen(false)}
              className={`${l.wideOnly ? "xl:hidden" : ""} flex items-center rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-card`}
            >
              {l.label}
              <NavPill pill={l.pill} />
            </Link>
          ))}
          {section && (
            <>
              <div className="mx-3 my-1 border-t border-brand-border" />
              <div className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{section.heading}</div>
              {section.items.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className="flex items-center rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-card"
                >
                  {l.label}
                </Link>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The drawer's auth block. The desktop bar has its own, condensed into
// AccountMenu when signed in. `onNavigate` closes the drawer on click.
function AuthActions({ isAdmin, user, onNavigate, className, ...rest }: { isAdmin: boolean; user: unknown; onNavigate?: () => void; className: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className} {...rest}>
      {user ? (
        <>
          {isAdmin && (
            <Link href="/admin" prefetch={false} onClick={onNavigate} className="btn btn-ghost text-sm">Admin</Link>
          )}
          <Link href="/dashboard" prefetch={false} onClick={onNavigate} className="btn btn-ghost text-sm">Account</Link>
          <Link href="/following" prefetch={false} onClick={onNavigate} className="btn btn-ghost text-sm">Following</Link>
          {/* Detaches this browser's push subscription before signing out, so
              the next person to sign in here is not sent the previous user's
              notifications. Shared with DashboardShell — see src/lib/logout.ts. */}
          <LogoutButton className="btn btn-ghost text-sm" onBeforeLogout={onNavigate} />
        </>
      ) : (
        <>
          <Link href="/login" prefetch={false} onClick={onNavigate} className="btn btn-ghost text-sm">Log in</Link>
          <Link href="/register" prefetch={false} onClick={onNavigate} className="btn btn-primary text-sm">Join</Link>
        </>
      )}
    </div>
  );
}

const MENU_ITEM = "flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-gray-300 hover:bg-brand-card";

/**
 * Signed in, the desktop bar carries ONE account control instead of the
 * drawer's four buttons (Admin, Account, Following, Log out): side by side
 * they were ~380px, enough on their own to push the bar past the screen at
 * every width. Right-aligned, since it sits at the bar's right edge.
 */
function AccountMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-ghost gap-1.5 px-3 text-sm">
        <CircleUser size={18} aria-hidden="true" />
        Account
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-lg border border-brand-border bg-brand-bg p-1 shadow-xl">
          {isAdmin && (
            <Link href="/admin" prefetch={false} onClick={close} className={MENU_ITEM}>Admin</Link>
          )}
          <Link href="/dashboard" prefetch={false} onClick={close} className={MENU_ITEM}>Dashboard</Link>
          <Link href="/following" prefetch={false} onClick={close} className={MENU_ITEM}>Following</Link>
          <div className="mx-3 my-1 border-t border-brand-border" />
          <LogoutButton className={MENU_ITEM} onBeforeLogout={close} />
        </div>
      )}
    </div>
  );
}

/**
 * Search between lg and xl: an icon that opens the box in a panel under the
 * bar. The inline box needs ~200px the bar does not have at 1024px; from xl it
 * is inline again (see the bar below).
 */
function SearchToggle() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div className="relative hidden lg:block xl:hidden" ref={ref}>
      <button
        type="button"
        aria-label={open ? "Close search" : "Search"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-brand-border text-gray-300 hover:bg-brand-card"
      >
        {open ? <X size={16} /> : <Search size={16} />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-brand-border bg-brand-bg p-2 shadow-xl">
          <SearchBox autoFocus onNavigate={close} />
        </div>
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
    const unlock = lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-brand-border surface-blur backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2.5 px-4 py-3">
          <Link href="/" aria-label="BetGenius home" prefetch={false} className="flex shrink-0 items-center gap-2">
            <BrandLockup className="text-xl font-bold tracking-tight" />
          </Link>
          {/* No overflow-x-auto: a scroll container would clip the
              absolutely-positioned dropdowns. The row has to fit instead, which
              is why it starts at lg (tablets get the drawer) and why
              scripts/check-nav-fit.tsx measures it in a browser. */}
          {/* The desktop link row. Hidden in the installed app: the bottom tab
              bar is the primary navigation there, and a second full set of
              links above it would be the same destinations twice. Everything
              this row reaches that the tab bar does not (Standings, StatsPad,
              Multi Bets, the VIP/Premium tiers) stays reachable through the
              drawer, which is why the drawer is NOT marked web-only. */}
          <nav data-web-only className="hidden items-center gap-1 lg:flex">
            <NavDropdown label="Tips" items={TIP_LINKS} section={{ heading: "By market", items: MARKET_LINKS }} />
            {PRIMARY_LINKS.map((l) => (
              <Link key={l.href} href={l.href} prefetch={false} className={`${l.wideOnly ? "hidden xl:block" : ""} whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-brand-card`}>
                {l.label}
              </Link>
            ))}
            <NavDropdown label="More" items={[...PRIMARY_LINKS.filter((l) => l.wideOnly), ...SECONDARY_LINKS]} />
          </nav>

          {/* Desktop search sits between the links and the auth actions, at a
              fixed width rather than flexing: inline from xl, an icon with a
              panel from lg (SearchToggle), in the drawer below that. */}
          <div className="hidden w-48 xl:block">
            <SearchBox />
          </div>
          <SearchToggle />

          {/* Always visible, both breakpoints. Unlike the auth actions it is a
              single icon-width control, so it costs nothing in the mobile bar
              and does not need to hide in the drawer to fit. */}
          {/* The permanent way back to the app offer once the bottom banner
              has been dismissed. Web-only: inside the installed app it would
              be offering the app to someone already using it. */}
          <Link
            href="/app"
            prefetch={false}
            data-web-only
            aria-label="Get the app"
            title="Get the app"
            className="btn btn-ghost h-9 w-9 justify-center p-0"
          >
            {/* Icon only: the label cost ~75px the bar does not have even at
                its full 1280px. The drawer's entry keeps the words. */}
            <Smartphone size={18} aria-hidden="true" />
          </Link>
          <ThemeToggle />
          <NotificationBell />

          {/* Auth lives in the top bar from lg only; below that it is in the
              drawer. Signed in it is one menu (AccountMenu). Web-only: the
              Account tab owns sign-in/out and the dashboard in the app. */}
          <div data-web-only className="hidden items-center gap-2 lg:flex">
            {user ? (
              <AccountMenu isAdmin={isAdmin} />
            ) : (
              <>
                <Link href="/login" prefetch={false} className="btn btn-ghost whitespace-nowrap text-sm">Log in</Link>
                <Link href="/register" prefetch={false} className="btn btn-primary text-sm">Join</Link>
              </>
            )}
          </div>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav-drawer"
            onClick={() => setOpen((v) => !v)}
            // lg:hidden in a browser tab, where the desktop link row above
            // covers the same ground. In the installed app that row is gone at
            // every width, so the drawer is the only way to reach Standings,
            // StatsPad, Multi Bets, pricing and the legal pages — hence the
            // app-shell override, which re-shows it above md.
            className="btn btn-ghost p-2 lg:hidden app-shell-menu"
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
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <div id="mobile-nav-drawer" className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-l border-brand-border bg-brand-bg p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <BrandLockup className="text-lg font-bold" />
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
                      prefetch={false}
                      onClick={() => setOpen(false)}
                      className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-card"
                    >
                      {l.label}
                      <NavPill pill={l.pill} />
                    </Link>
                  ))}
                  <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">By market</div>
                  {MARKET_LINKS.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      prefetch={false}
                      onClick={() => setOpen(false)}
                      className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-brand-card"
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </details>

              {PRIMARY_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  prefetch={false}
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
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-gray-400 hover:bg-brand-card"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <Link
              href="/app"
              prefetch={false}
              data-web-only
              onClick={() => setOpen(false)}
              className="mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-200 hover:bg-brand-card"
            >
              <Smartphone size={16} aria-hidden="true" />
              Get the app
            </Link>
            <AuthActions isAdmin={isAdmin} user={user} onNavigate={() => setOpen(false)} className="mt-4 flex flex-col gap-2 border-t border-brand-border pt-4" />
          </div>
        </div>
      )}
    </>
  );
}
