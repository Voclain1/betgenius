/**
 * The one place the paths to the brand pack's shipped artwork are written down.
 *
 * These files are supplied artwork, not generated output — the pack ships them
 * at fixed sizes and they are checked into public/ verbatim. Referring to them
 * through named constants rather than string literals is what keeps the nav,
 * the document head, the manifest and the social cards pointing at the same
 * files after the next pack lands; a stale literal in one of four places is
 * invisible until someone notices the old mark in a tab.
 *
 * The pack ships a light-theme variant beside every dark one. Only the nav mark
 * uses both: the site has a real light theme (src/lib/theme.ts, and the toggle
 * in the nav), and a white-on-transparent mark is invisible against it. The
 * swap is done in CSS — see `.brand-mark-dark` / `.brand-mark-light` in
 * globals.css — not here, so the correct mark is in the server-rendered HTML.
 *
 * Everything else stays dark-only, correctly: the favicon, the PWA icons and
 * the social card all carry the pack's own dark plate, so they are opaque and
 * legible wherever they land regardless of the page theme behind them.
 */

/**
 * The standalone icon mark, transparent ground, for rendering on top of the
 * app's own surfaces (the nav). The square icon files under /icons are the same
 * mark but baked onto the pack's dark #07111f plate, which would show as a
 * mismatched rectangle against the nav's translucent bar.
 */
export const BRAND_ICON_DARK = "/brand/betgenius-icon-dark.png";

/** The same mark in navy+emerald, for the light theme. */
export const BRAND_ICON_LIGHT = "/brand/betgenius-icon-light.png";

/**
 * Intrinsic pixel size, shared by both variants — they are the same artwork in
 * two colourways and the pack exports them at identical dimensions. Passing it
 * to <Image> is what reserves the box before the PNG loads; without it the nav
 * reflows on every cold load.
 */
export const BRAND_ICON_SIZE = { width: 520, height: 530 } as const;

/**
 * The default social card: the 1024px square profile image on the pack's dark
 * ground.
 *
 * Square, not 1.91:1 — this is the pack's profile image, which is the only
 * social artwork it ships. That is why the Twitter card stays `summary` (square
 * thumbnail) rather than `summary_large_image`, which would letterbox it.
 */
export const SOCIAL_CARD = "/og/betgenius-social-1024.png";

export const SOCIAL_CARD_SIZE = { width: 1024, height: 1024 } as const;

export const SOCIAL_CARD_ALT = "BetGenius";

/**
 * The openGraph/twitter `images` entry, shared by the root layout's site-wide
 * default and by trustMetadata's per-page overrides.
 *
 * Next resolves the relative path against `metadataBase` (set in the root
 * layout), so this stays a path rather than an absolute URL and follows the
 * deployment automatically.
 */
export const SOCIAL_CARD_IMAGE = {
  url: SOCIAL_CARD,
  ...SOCIAL_CARD_SIZE,
  alt: SOCIAL_CARD_ALT,
} as const;
