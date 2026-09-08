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
 *   An ad never appears above the first pick on a page, and never inside a
 *   list or grid of picks. It sits between two non-pick sections, or after
 *   the pick content has ended.
 *
 * That is why the homepage leaderboard is down beside "Popular leagues" rather
 * than in the usual spot under the hero, and why the category feeds carry
 * their band at the foot rather than above the grid: the feeds ARE the picks,
 * top to bottom, so there is no honest in-content position on them.
 *
 * Every slot is also labelled "Advertisement" in text, not only by shape.
 * `<aside>` gives it a complementary landmark with that accessible name, so
 * the separation holds for a screen reader as well as for an eye.
 */

function AdLabel() {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
      Advertisement
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
    <aside
      aria-label="Advertisement"
      className="flex flex-col items-center gap-2 border-y border-brand-border bg-brand-card/25 py-5"
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
      <div className="sticky top-24 flex flex-col items-center gap-2 rounded-lg bg-brand-card/25 py-4">
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
