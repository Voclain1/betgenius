/**
 * "Preview data, not live" marker.
 *
 * ONE environment check, in ONE place.
 *
 * VERCEL_ENV, not NODE_ENV. NODE_ENV is "production" in a Preview build too,
 * so keying off it would put this banner on the live site — the exact failure
 * this component must not have. VERCEL_ENV is set by Vercel to
 * "production" | "preview" | "development", and is absent anywhere else.
 *
 * Fails CLOSED: renders only on the exact string "preview". Production,
 * development, local `next start`, a self-hosted box, or an unset variable all
 * render nothing. There is no way to reach the banner without VERCEL_ENV being
 * literally "preview".
 *
 * Deliberately site-wide rather than only on pages showing seeded predictions.
 * Targeting those pages would mean an env check at each one — scattered,
 * silently missed whenever a page is added, and the opposite of the
 * single-switch removal this is supposed to have. Site-wide is one check that
 * cannot miss a page.
 *
 * TO REMOVE: delete this file and its two lines in (public)/layout.tsx.
 */
export function PreviewDataBanner() {
  if (process.env.VERCEL_ENV !== "preview") return null;

  return (
    <div
      role="status"
      className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs font-medium text-amber-200"
    >
      Preview data, not live — predictions here are seeded demo content.
    </div>
  );
}
