/**
 * The logo preloader shown while a public page first loads.
 *
 * Shown on a HARD load only: client-side navigations are instant and never
 * see it. Skipped on the pages where a reader is waiting on something else
 * — the live feeds (every second counts there) and the sign-in flows (a
 * splash in front of a form is friction, not polish). /admin and /dashboard
 * are separate layouts and never render it at all.
 */
export const PRELOADER_SKIP = ["/livescores", "/fixtures", "/login", "/register", "/forgot-password", "/reset-password"] as const;

/** The longest the overlay can stay up, whatever the page is still loading (ads, images). */
export const PRELOADER_MAX_MS = 2500;
/** The shortest it stays up once shown, so a fast load reads as a beat rather than a flicker. */
export const PRELOADER_MIN_MS = 350;

export function preloaderShows(pathname: string): boolean {
  return !PRELOADER_SKIP.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Runs inline, just before the overlay in the server HTML, so a skipped
 * page hides it before it is ever painted. It never removes the node (React
 * would see a hydration mismatch); it marks <html> instead, which already
 * opts out of hydration warnings, and the CSS hides the overlay from that
 * mark. Without JavaScript the CSS animation hides it on its own.
 */
export const PRELOADER_SCRIPT = `(function(){var d=document.documentElement;var skip=${JSON.stringify(PRELOADER_SKIP)};var p=location.pathname;
for(var i=0;i<skip.length;i++){if(p===skip[i]||p.indexOf(skip[i]+"/")===0){d.setAttribute("data-preloaded","skip");return;}}
var t0=Date.now(),done=false;function hide(){if(done)return;done=true;d.setAttribute("data-preloaded","1");}
function finish(){setTimeout(hide,Math.max(0,${PRELOADER_MIN_MS}-(Date.now()-t0)));}
if(document.readyState==="complete")finish();else window.addEventListener("load",finish,{once:true});
setTimeout(hide,${PRELOADER_MAX_MS});})();`;
