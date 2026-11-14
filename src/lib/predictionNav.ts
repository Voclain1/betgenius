/**
 * How the Tips menu is organised — a navigation classification only.
 *
 * Nothing here decides which predictions exist, what a category contains or
 * who may read it; those stay with categoryPredictions.ts, marketHubs.ts and
 * the entitlement checks. This file only answers "which link goes under which
 * heading" and "is this link the page the reader is on", so the desktop menu,
 * the phone drawer and the tests read one list. Client-safe (no database).
 *
 * The three groups say what KIND of thing a link is, because the menu used to
 * run curated products (Banker), time views (Today) and markets (BTTS) under
 * one undifferentiated list and a separate "By market" tail:
 *
 *   By day        — the same published tips cut by when the matches are played
 *   Curated tips  — a BetGenius selection with its own rules: Genius, Featured,
 *                   Banker, Bet of the Day, Combo Bets, Goals, VIP, Premium
 *   By market     — every free tip of the day in one betting market
 *
 * Banker and Bet of the Day are different products (up to seven picks vs one)
 * and stay two entries with their own names and routes.
 */
import { MARKET_HUBS } from "@/lib/marketHubs";

export type NavLink = { href: string; label: string; pill?: "vip" | "premium"; wideOnly?: boolean };

export type TipGroup = { id: "day" | "curated" | "market"; heading: string; items: NavLink[] };

/** Today is the default feed; Weekend and Midweek used to be reachable only from the homepage. */
export const DAY_LINKS: NavLink[] = [
  { href: "/predictions/today", label: "Today" },
  { href: "/predictions/weekend", label: "Weekend" },
  { href: "/predictions/midweek", label: "Midweek" },
];

export const CURATED_LINKS: NavLink[] = [
  { href: "/predictions/genius", label: "Genius" },
  { href: "/predictions/featured", label: "Featured" },
  { href: "/predictions/banker", label: "Banker" },
  { href: "/predictions/bet-of-the-day", label: "Bet of the Day" },
  // "Combo Bets" = two picks on ONE match. "Multi Bets" (/multi-bets, a
  // primary link) = one pick across SEVERAL matches.
  { href: "/predictions/combo-bets", label: "Combo Bets" },
  { href: "/predictions/goals", label: "Goals" },
  { href: "/predictions/vip", label: "VIP", pill: "vip" },
  { href: "/predictions/premium", label: "Premium", pill: "premium" },
];

export const MARKET_LINKS: NavLink[] = MARKET_HUBS.map((m) => ({ href: m.href, label: m.label }));

export const TIP_GROUPS: TipGroup[] = [
  { id: "day", heading: "By day", items: DAY_LINKS },
  { id: "curated", heading: "Curated tips", items: CURATED_LINKS },
  { id: "market", heading: "By market", items: MARKET_LINKS },
];

/**
 * True when `pathname` is `href` or a page under it. Segment-aware, so
 * /predictions/goals does not light up /predictions/goals-extra, and the query
 * string (never part of a pathname) cannot affect it.
 */
export function isCurrentPath(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return clean === href || clean.startsWith(`${href}/`);
}

/** True on any page the Tips menu links to, so its trigger can show where the reader is. */
export function onTipsPage(pathname: string | null | undefined): boolean {
  return TIP_GROUPS.some((g) => g.items.some((l) => isCurrentPath(l.href, pathname)));
}
