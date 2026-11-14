/**
 * The returning reader's shortcuts: what a signed-in person can jump to from
 * their dashboard without scrolling past today's list.
 *
 * Pure and client-safe. Every count comes from data the dashboard has already
 * loaded for its own sections (saved total, upcoming fixtures, followed teams
 * and competitions); nothing here reads the database, a clock or a "last
 * visit" — BetGenius stores no last-visit time, and none is invented.
 */

export type ShortcutTarget = "upcoming" | "saved" | "favourites" | "following" | "preferences";
export type ShortcutSurface = "jump_row" | "account_menu" | "sidebar";

export const SHORTCUT_TARGETS: readonly ShortcutTarget[] = ["upcoming", "saved", "favourites", "following", "preferences"];
export const SHORTCUT_SURFACES: readonly ShortcutSurface[] = ["jump_row", "account_menu", "sidebar"];

export type JumpLink = { target: ShortcutTarget; label: string; href: string; count: number | null; external: boolean };

/** The dashboard section ids the in-page links point at. One list, read by the page and the tests. */
export const DASHBOARD_ANCHORS = { upcoming: "upcoming", saved: "saved", favourites: "favourites" } as const;

/**
 * The jump row: in-page links to the dashboard's own sections, then the one
 * feed that lives on its own page. A count is shown only when it is a real,
 * positive number, so the row never says "0" where the section says it has
 * nothing. "Following" always appears: it is where a reader manages and reads
 * what they follow, and is empty-safe on its own page.
 */
export function jumpLinks(input: { savedTotal: number; upcomingCount: number; favouriteCount: number }): JumpLink[] {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
  return [
    { target: "upcoming", label: "Upcoming", href: `#${DASHBOARD_ANCHORS.upcoming}`, count: n(input.upcomingCount), external: false },
    { target: "saved", label: "Saved", href: `#${DASHBOARD_ANCHORS.saved}`, count: n(input.savedTotal), external: false },
    { target: "favourites", label: "Favourites", href: `#${DASHBOARD_ANCHORS.favourites}`, count: n(input.favouriteCount), external: false },
    { target: "following", label: "Following", href: "/following", count: null, external: true },
  ];
}

/** A coarse bucket for how many things a reader follows, so analytics never carries an exact personal count. */
export function followBucket(count: number): "0" | "1_5" | "6_plus" {
  return !(count > 0) ? "0" : count <= 5 ? "1_5" : "6_plus";
}
