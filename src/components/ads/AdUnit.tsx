"use client";

import { useEffect, useRef, useState } from "react";
import { AD_UNITS, type AdUnitId } from "@/lib/ads";

/**
 * The low-level ad slot. Everything on the site goes through this file, and
 * three decisions are baked in here rather than left to each call site.
 *
 * 1. EACH UNIT GETS ITS OWN WINDOW, ON ITS OWN ORIGIN. The network configures
 *    a banner by assigning to a bare `atOptions` global, so two units in one
 *    document overwrite each other (see the header of src/lib/ads.ts). Loading
 *    each unit in a frame makes `atOptions` a global of that frame and of
 *    nothing else. The frame is sandboxed WITHOUT `allow-same-origin`, so the
 *    ad script also runs on an opaque origin and cannot reach our cookies, our
 *    storage or our DOM; `allow-popups` and `allow-popups-to-escape-sandbox`
 *    are the two capabilities a creative genuinely needs — a click has to be
 *    able to open the advertiser's page — and nothing else is granted.
 *
 *    The frame's document is served by /ads/frame rather than carried in a
 *    `srcdoc` attribute. That is not a style preference: a `srcdoc` document
 *    on an opaque origin never issues the script request at all, so that
 *    combination serves zero ads. The measurements are in the route file.
 *
 * 2. THE BOX IS RESERVED BEFORE ANYTHING LOADS. The outer div is sized from
 *    the same width/height the frame is configured with, so the space exists
 *    from the first paint. An ad that fills, an ad that does not fill and an
 *    ad that is still loading all occupy identical space, which is what keeps
 *    Cumulative Layout Shift at zero. Never make this box `h-auto`.
 *
 * 3. NOTHING LOADS UNTIL IT IS NEARLY ON SCREEN. The frame is not rendered at
 *    all until an IntersectionObserver says the reserved box is within 300px
 *    of the viewport. Below-the-fold inventory therefore costs nothing at
 *    load: no request, no third-party connection, no main-thread time, so it
 *    cannot touch LCP or TBT.
 *
 *    This also does the responsive work for free. A slot inside `hidden
 *    md:block` has no layout box below md, so it never intersects and never
 *    loads — which is how AdLeaderboard can render both a 728x90 and a 320x50
 *    into the page and still only ever fetch the one the reader can see.
 */

/** Mounts when the element is within `rootMargin` of the viewport, once. */
function useNearViewport<T extends HTMLElement>(rootMargin = "300px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // No IntersectionObserver (a very old browser, or a test environment):
    // show the ad rather than silently withholding every slot on the site.
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, near };
}

/** See note 1. Deliberately does not include allow-same-origin. */
const SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/**
 * One unit, in its reserved box.
 *
 * `title` is not decoration: an iframe with no accessible name is announced by
 * a screen reader as an unlabelled "frame".
 */
export function AdFrame({ id }: { id: AdUnitId }) {
  const unit = AD_UNITS[id];
  const { ref, near } = useNearViewport<HTMLDivElement>();

  // A banner is exactly its creative's size. The Native Banner's height is
  // chosen by the network at fill time, so it gets the measured reserve from
  // AD_UNITS and the full width of its container.
  const width = unit.kind === "iframe" ? unit.width : undefined;
  const height = unit.kind === "iframe" ? unit.height : unit.reservedHeight;

  return (
    <div
      ref={ref}
      data-ad-unit={unit.id}
      // Inline rather than Tailwind classes: these numbers come from AD_UNITS
      // at runtime, and Tailwind cannot generate a class for a value it never
      // sees in the source.
      style={{ width, height }}
      className={unit.kind === "iframe" ? "max-w-full overflow-hidden" : "w-full max-w-3xl overflow-hidden"}
    >
      {near && (
        <iframe
          title="Advertisement"
          src={`/ads/frame?unit=${unit.id}`}
          width={width}
          height={height}
          scrolling="no"
          sandbox={SANDBOX}
          // Belt and braces with the lazy mount above: if the observer ever
          // fires early, the browser still defers the load itself.
          loading="lazy"
          // Nothing in an ad needs our Referer beyond the origin, and the full
          // path of a page a reader is on is not the network's business.
          referrerPolicy="strict-origin"
          className="block border-0"
          // colorScheme "normal" is what stops an UNFILLED slot painting as a
          // solid white block on the dark theme, and it is not cosmetic
          // guesswork — it was measured. globals.css sets `color-scheme: dark`
          // on :root, every element inherits it, and when an iframe's used
          // colour scheme is dark while the document inside it declares none,
          // Chrome refuses to composite the frame transparently and paints an
          // opaque white backdrop behind it instead. Sampled at the centre of
          // a 160x600 rail slot with no fill:
          //
          //   dark theme,  inheriting :root  rgb(255,255,255)  <- the bug
          //   dark theme,  colorScheme normal rgb(11,17,23)    <- the band
          //   light theme, either            rgb(249,250,251)
          //
          // Setting it here rather than declaring a scheme inside the frame
          // document is deliberate: the document is cached and shared by every
          // reader, so it cannot know which theme any one of them is using.
          style={{ width: width ?? "100%", height, colorScheme: "normal" }}
        />
      )}
    </div>
  );
}
