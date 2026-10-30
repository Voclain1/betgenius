/**
 * Where the top banner sits and how it stays out of the way.
 *
 * The banner sits flush under the header, full width, with no frame or margin
 * (src/components/ads/TopBanner.tsx). Its place is an empty slot the public
 * layout renders right after <Nav /> (TOP_BANNER_SLOT_ID). A page that carries
 * ads mounts <TopBanner />, which renders a hidden marker in the page and the
 * banner itself into that slot.
 *
 * NO JUMP ON LOAD. The slot's height comes from CSS (globals.css,
 * `.top-banner-slot`), and only while the page holds the marker and the
 * reader has not closed the banner. Both are known before first paint: the
 * marker is in the server HTML, and TOP_BANNER_INIT_SCRIPT marks <html> from
 * sessionStorage in the head. So the space is there from the first frame and
 * the banner drops into it.
 *
 * CLOSING returns the page to exactly how it looks without a banner: the slot
 * goes to zero height, nothing is left behind, and it stays closed for the
 * rest of the visit.
 *
 * Lives outside components/ads on purpose: the public layout imports the slot
 * id, and the public layout also serves the ad-free pages, which must not reach
 * an ad component (scripts/check-ad-placement.ts). An empty slot is not an ad.
 */
export const TOP_BANNER_SLOT_ID = "top-banner-slot";
export const TOP_BANNER_CLOSED_KEY = "betgenius:top-banner-closed";
export const TOP_BANNER_CLOSED_ATTR = "data-top-banner-closed";
/** Set while a house banner (4:1 artwork) fills the slot, which then needs the taller phone box. */
export const TOP_BANNER_HOUSE_KEY = "betgenius:top-banner-house";
export const TOP_BANNER_HOUSE_ATTR = "data-top-banner-house";

/** Runs in <head> before first paint, so a banner closed earlier in the visit never takes space. */
export const TOP_BANNER_INIT_SCRIPT = `(function(){try{var h=document.documentElement;if(sessionStorage.getItem(${JSON.stringify(TOP_BANNER_CLOSED_KEY)}))h.setAttribute(${JSON.stringify(TOP_BANNER_CLOSED_ATTR)},"");if(sessionStorage.getItem(${JSON.stringify(TOP_BANNER_HOUSE_KEY)}))h.setAttribute(${JSON.stringify(TOP_BANNER_HOUSE_ATTR)},"");}catch(e){}})();`;
