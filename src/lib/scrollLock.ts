/**
 * Background-scroll lock shared by everything that covers the page: the
 * site menu drawer, the dashboard drawer and the between-pages ad.
 *
 * Counted, not saved-and-restored per caller. Each overlay used to save
 * body.style.overflow, set "hidden", and put its saved value back on close.
 * Two of them overlapping broke that: tapping a link in the open menu shows
 * the ad, which saved the menu's "hidden" as the value to restore; the menu
 * closed and restored ""; then the ad closed and restored "hidden", leaving
 * the page unscrollable until a refresh. Here the page unlocks exactly when
 * the last holder releases, whatever order they close in.
 */
let holders = 0;
let original = "";

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (holders === 0) {
    original = document.body.style.overflow === "hidden" ? "" : document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  holders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) document.body.style.overflow = original;
  };
}
