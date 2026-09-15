import { AdFrame } from "@/components/ads/AdUnit";

/**
 * The placements. Call sites use these, never AdFrame directly, so that what
 * an ad looks like on this site is decided in one file.
 *
 * HOW ADS ARE KEPT DISTINCT FROM PREDICTION CONTENT.
 *
 * Every piece of our own analysis on this site is a `.card`: solid
 * `bg-brand-card`, a solid `border-brand-border`, `rounded-xl`. Ads are
 * deliberately built out of the opposite set of primitives — a full-width
 * band, horizontal rules top and bottom, no rounding, a washed-out
 * `bg-brand-card/25` — so an ad and a pick never resolve to the same shape at
 * a glance. That is a visual rule, and it is only half of the separation.
 *
 * The structural half is where these are allowed to go, which is a rule the
 * components cannot enforce and the call sites have to keep:
 *
 *   An ad is always its own full-width block, between complete blocks of
 *   content. It is never inserted inside a prediction card, never overlaps
 *   one, and never splits one.
 *
 * THIS REPLACED AN EARLIER, STRICTER RULE — that an ad could never appear
 * above the first pick and never inside a list of picks, which is why the
 * feeds originally carried a single band at their foot and the match page put
 * its rectangle two thirds of the way down. That rule was retired
 * deliberately: it is the SPLITTING of a pick that misleads a reader, not the
 * proximity of a clearly-labelled block to one. Ads now sit high on a page and
 * between groups of picks, and the one line above is what holds.
 *
 * The homepage is the exception, and keeps the placement it already had.
 *
 * Where "between complete blocks" is decided per surface:
 *   - Feed pages break the list into groups and put a band between them, at
 *     the counts feedAdPositions() returns. See src/lib/ads.ts for why 6/3/3.
 *   - Non-feed pages put their band directly after the first main content
 *     section — the header, summary or info panel — rather than at the foot.
 *
 * Every slot also carries a visible "Ad" tag, not only a shape — see AdLabel
 * for why it is a corner tag and why its colour is the measured one rather
 * than the most muted one. `<aside>` additionally gives each slot a
 * complementary landmark named "Advertisement", so the separation holds for a
 * screen reader as well as for an eye.
 */

/**
 * The disclosure tag, on every slot without exception.
 *
 * A CORNER TAG, NOT A HEADER. This used to be a centred, letter-spaced
 * "ADVERTISEMENT" running the full width of the band, which read as a section
 * heading — it was the most prominent piece of typography in the block and
 * competed with the real headings around it. It is now a small "Ad" pinned to
 * the top-left corner: still on every slot, still legible, but chrome rather
 * than an announcement.
 *
 * IT IS ABSOLUTE, AND ITS CONTAINER'S TOP PADDING IS WHAT KEEPS IT CLEAR of
 * the creative. It sits inside that padding band above the unit, so it costs
 * no layout height and can never overlap an ad. Every container that renders
 * one must therefore be a positioned element with enough `pt-` to hold it —
 * see AdBand and AdRail, and note that `sticky` already positions the rail's
 * container, which is why nothing there adds `relative`.
 *
 * NOT `aria-hidden`. The landmark's own label already says "Advertisement",
 * so this is redundant for a screen reader — but a disclosure that exists only
 * as a container attribute is one refactor away from disappearing silently,
 * and a redundant one costs a reader nothing.
 *
 * THE COLOUR IS `text-gray-400`, AND IT IS NOT FREE TO GO FAINTER. The
 * obvious choice was gray-500, the site's most muted step, which is what the
 * old header used. Sampling the pixels actually painted behind the tag on
 * every slot in both themes says gray-500 gives 3.92:1 in dark and 4.07:1 in
 * light — under the 4.5:1 floor for text this size, so the disclosure was
 * failing that bar before this change too, at a larger size. gray-400
 * measures 7.47:1 dark and 5.62:1 light on the same probe.
 *
 * At 10px the tag still reads as chrome; contrast is what keeps it a
 * disclosure rather than decoration, and an opacity modifier or gray-500
 * would put it back under. Re-measure if the band's background changes.
 */
function AdLabel() {
  return (
    <span className="pointer-events-none absolute left-3 top-1.5 select-none text-[10px] font-medium leading-none text-gray-400">
      Ad
    </span>
  );
}

/**
 * The in-content band. Deliberately NOT a card — see the note above.
 *
 * No vertical margin of its own: every page that uses one of these places it
 * as a direct child of a `space-y-*` stack, which already owns the rhythm
 * between sections. A `my-*` here would either be overridden by that stack or,
 * worse, win on some pages and lose on others.
 */
function AdBand({ children }: { children: React.ReactNode }) {
  return (
    // `relative` is what the corner tag positions against, and `pt-5` is the
    // room it sits in. The gap that used to separate a stacked label from the
    // unit is gone with it — the label no longer occupies a row.
    <aside
      aria-label="Advertisement"
      className="relative flex flex-col items-center border-y border-brand-border bg-brand-card/25 pb-5 pt-5"
    >
      <AdLabel />
      {children}
    </aside>
  );
}

/**
 * The leaderboard pair: 728x90 on desktop, 320x50 on a phone.
 *
 * Both are rendered into the page and one is hidden by CSS at every width.
 * Only the visible one ever loads a single byte — a `display:none` element has
 * no layout box, so it never intersects the viewport and AdFrame's observer
 * never fires for it. That is also why this is not a `useMediaQuery`: picking
 * in JavaScript would mean the slot is empty until after hydration, and the
 * reserved box would be the wrong size until then.
 */
export function AdLeaderboard() {
  return (
    <AdBand>
      <div className="hidden md:block">
        <AdFrame id="leaderboard" />
      </div>
      <div className="md:hidden">
        <AdFrame id="mobileBanner" />
      </div>
    </AdBand>
  );
}

/**
 * 468x60 on desktop, the 300x250 rectangle on a phone.
 *
 * The narrower desktop half-banner is for the utility pages, whose content is
 * a filter row and a table rather than a full-width grid — a 728 there reads
 * as a hole with a table under it. The phone half takes the rectangle rather
 * than the 320x50 because these pages have no leaderboard to be consistent
 * with and the taller unit is worth more.
 */
export function AdHalfBanner() {
  return (
    <AdBand>
      <div className="hidden md:block">
        <AdFrame id="banner468" />
      </div>
      <div className="md:hidden">
        <AdFrame id="rectangle" />
      </div>
    </AdBand>
  );
}

/**
 * The medium rectangle. The one unit that needs no breakpoint pair: 300px fits
 * inside a 320px phone viewport and still looks intentional centred in a
 * desktop content column.
 */
export function AdRectangle() {
  return (
    <AdBand>
      <AdFrame id="rectangle" />
    </AdBand>
  );
}

/**
 * The Native Banner band. Placed at the foot of a page, below everything the
 * reader came for.
 *
 * This is the unit with the highest chance of being mistaken for editorial
 * content — that is what "native" means — so the separation it gets is
 * positional rather than decorative: the same labelled band as every other
 * slot, in a place where the nearest pick is a screenful away. Nothing on this
 * site calls it in-content, and nothing should.
 */
export function AdNativeBand() {
  return (
    <AdBand>
      <AdFrame id="native" />
    </AdBand>
  );
}

/**
 * The placements an in-feed slot cycles through, in order.
 *
 * ROTATED RATHER THAN REPEATED, because a feed can carry three of these and
 * repeating one unit key three times in a single document is the thing this
 * whole integration is built to avoid — see the `atOptions` note in
 * src/lib/ads.ts. Rotating gives three distinct keys on a desktop feed
 * (728x90, then 300x250, then 468x60).
 *
 * On a phone the rotation collapses further than that: positions two and three
 * both resolve to the 300x250, because that is the only rectangle in the
 * inventory and the half banner has no phone-width counterpart of its own.
 * Two instances of one unit on a long feed is a smaller compromise than three,
 * and it only happens on feeds long enough to earn a third insertion.
 */
const IN_FEED_ROTATION = [AdLeaderboard, AdRectangle, AdHalfBanner] as const;

/**
 * One in-feed band. `index` is the insertion's ordinal in the feed (0, 1, 2),
 * not a row number — it selects which placement of the rotation to show.
 */
export function AdInFeed({ index }: { index: number }) {
  const Placement = IN_FEED_ROTATION[index % IN_FEED_ROTATION.length];
  return <Placement />;
}

/** The two units the rail is allowed to carry. */
type RailUnit = "skyscraper" | "railHalf";

/**
 * The sidebar rail.
 *
 * Rendered ONLY at `xl` and above, and only on the two pages deep enough to
 * carry one: the match page and a league page. Both are long, mostly
 * non-pick pages — form, team news, stats, standings, results — where a 160px
 * column costs the content nothing.
 *
 * The width maths is why it is `xl` and not `lg`. The content box is
 * `max-w-7xl px-4`, so at the xl breakpoint (1280px) the main column keeps
 * 1280 - 32 - 160 - 24 = 1064px, which is still wider than the `lg` breakpoint
 * every grid on those pages was laid out against. Below 1280 the rail does not
 * exist at all and the page is byte-identical to what it was before — no
 * reflow, no squeeze, nothing to check.
 *
 * One unit per rail, deliberately. Stacking the 600 and the 300 in one sticky
 * block makes it ~950px tall, which does not fit the usable height of a 1080p
 * window — the lower unit would sit permanently below the fold. So the tall
 * unit lives on the match rail and the half on the league rail.
 */
export function AdRail({ unit }: { unit: RailUnit }) {
  return (
    <aside aria-label="Advertisement" className="hidden xl:block">
      {/* top-24 clears the sticky nav. */}
      {/* No `relative` here on purpose: `sticky` is already a positioned
          element, so it is the corner tag's containing block, and adding
          `relative` would break the pinning. pt-5 rather than py-4 to give the
          tag the same clearance it has in the band. */}
      <div className="sticky top-24 flex flex-col items-center rounded-lg bg-brand-card/25 pb-4 pt-5">
        <AdLabel />
        <AdFrame id={unit} />
      </div>
    </aside>
  );
}

/**
 * Wraps a page body so a rail can sit beside it.
 *
 * A separate component rather than a grid written inline on each page, because
 * the two pages that use it must not be free to disagree about the column
 * widths — the whole safety argument for the rail (see AdRail) is the specific
 * arithmetic of `minmax(0,1fr) 160px` inside `max-w-7xl px-4` at `xl`.
 *
 * `min-w-0` on the content column is not optional: a grid item's default
 * `min-width:auto` refuses to shrink below its content's intrinsic width, and
 * one wide table on these pages — standings, the results list — would push the
 * rail off the side of the container instead of scrolling inside its own box.
 *
 * Below `xl` this renders a plain wrapper `div` with no grid at all, so the
 * page reflows exactly as it did before the rail existed.
 */
export function WithAdRail({ unit, children }: { unit: RailUnit; children: React.ReactNode }) {
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_160px] xl:items-start xl:gap-6">
      <div className="min-w-0">{children}</div>
      <AdRail unit={unit} />
    </div>
  );
}
