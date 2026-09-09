"use client";

import { useEffect, useRef, useState } from "react";
import { AD_UNITS, adFrameSrc, adsAreCrossOrigin, type AdUnitId } from "@/lib/ads";

/**
 * The low-level ad slot. Everything on the site goes through this file, and
 * three decisions are baked in here rather than left to each call site.
 *
 * 1. EACH UNIT GETS ITS OWN WINDOW, ON ITS OWN HOSTNAME. The network
 *    configures a banner by assigning to a bare `atOptions` global, so two
 *    units in one document overwrite each other (see the header of
 *    src/lib/ads.ts). Loading each unit in a frame makes `atOptions` a global
 *    of that frame and of nothing else.
 *
 *    ISOLATION COMES FROM THE HOSTNAME, NOT FROM THE SANDBOX. The frame is
 *    served from ADS_ORIGIN — a different host from the site — so the Same
 *    Origin Policy is what stops the ad script reaching our cookies, storage
 *    or DOM. `allow-same-origin` is granted on top of that, and on a
 *    cross-origin frame it means "keep your own real origin", not "share the
 *    embedder's": the frame stays ads.betgenius.ng and stays walled off. The
 *    flag is what an opaque origin denies the script, and denying it is what
 *    made every slot serve nothing.
 *
 *    It is granted ONLY when a separate origin is actually configured. Same
 *    origin plus `allow-same-origin` plus `allow-scripts` is the dangerous
 *    combination, so a missing NEXT_PUBLIC_ADS_ORIGIN degrades to no fill
 *    rather than to an ad script running on www.
 *
 *    `allow-popups` and `allow-popups-to-escape-sandbox` are the two other
 *    capabilities a creative genuinely needs — a click has to be able to open
 *    the advertiser's page — and nothing else is granted.
 *
 *    The frame's document is served by a route rather than carried in a
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

/**
 * See note 1. `allow-same-origin` is appended ONLY when the frame is served
 * from another hostname, where it grants the frame its own origin rather than
 * ours. On a same-origin frame it would hand the ad script the run of the
 * site, so the two must never be decoupled.
 */
const BASE_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";
const sandboxFor = (crossOrigin: boolean) =>
  crossOrigin ? `${BASE_SANDBOX} allow-same-origin` : BASE_SANDBOX;

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
          src={adFrameSrc(unit.id)}
          width={width}
          height={height}
          scrolling="no"
          sandbox={sandboxFor(adsAreCrossOrigin())}
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
