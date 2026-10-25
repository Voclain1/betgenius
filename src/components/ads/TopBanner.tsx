"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AdFrame } from "@/components/ads/AdUnit";
import { AdLabel } from "@/components/ads/AdPlacements";
import { bannerImageSrc, pickBanner, type PublicBanner } from "@/lib/houseBanners";

/**
 * The top banner: the first thing under the menu on every page that carries
 * ads, with a tab to fold it away.
 *
 * WHAT FILLS IT. A house banner from /admin/banners when one is live (several
 * share the slot, one per page view); otherwise the Adsterra leaderboard,
 * 728x90 on desktop and 320x50 on a phone. See src/lib/houseBanners.ts.
 *
 * ONE BOX, WHATEVER FILLS IT: 728x90 from md up, a full-width 16:5 box (max
 * 400px wide) on a phone. The box is painted at its final size before the
 * banner list arrives, so choosing the banner after hydration shifts nothing,
 * and pages keep their static or cached rendering: the list comes from
 * /api/banners, cached at the edge for a minute.
 *
 * FOLDING is for this page view only. Remembering it across pages would mean
 * reading storage after the first paint and collapsing the box then, which is
 * exactly the layout shift the fixed box exists to avoid.
 *
 * Mounted only where ads already are (the same files that mount
 * AdStickyMobile), so the ad-free routes stay ad-free; it lives in
 * components/ads so scripts/check-ad-placement.ts walks it like every other slot.
 */
export function TopBanner() {
  const [banners, setBanners] = useState<PublicBanner[] | null>(null);
  const [banner, setBanner] = useState<PublicBanner | null>(null);
  const [folded, setFolded] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/banners")
      .then((r) => (r.ok ? r.json() : { banners: [] }))
      .then((j: { banners?: PublicBanner[] }) => {
        if (cancelled) return;
        const list = Array.isArray(j.banners) ? j.banners : [];
        setBanners(list);
        setBanner(pickBanner(list));
      })
      .catch(() => !cancelled && setBanners([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // One view per page view, counted once at least half the banner is on screen.
  useEffect(() => {
    const el = box.current;
    if (!banner || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        try {
          navigator.sendBeacon?.(`/api/banners/${banner.id}/view`);
        } catch {
          // A lost view is not worth an error.
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [banner]);

  const labelled = banner ? banner.sponsored : banners !== null;

  return (
    <aside aria-label={banner && !banner.sponsored ? "Promotion" : "Advertisement"}>
      {!folded && (
        <div className="relative flex justify-center border-y border-brand-border bg-brand-card/25 pb-3 pt-5">
          {labelled && <AdLabel />}
          <div
            ref={box}
            data-top-banner
            className="relative flex aspect-[16/5] w-full max-w-[400px] items-center justify-center overflow-hidden md:aspect-auto md:h-[90px] md:w-[728px] md:max-w-none"
          >
            {banner ? (
              <a
                href={`/api/banners/${banner.id}/click`}
                target="_blank"
                rel={banner.sponsored ? "sponsored noopener" : "noopener"}
                className="block h-full w-full"
              >
                <picture>
                  {banner.hasMobile && <source media="(max-width: 767px)" srcSet={bannerImageSrc(banner, "mobile")} />}
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route with its own cache headers */}
                  <img src={bannerImageSrc(banner, "desktop")} alt={banner.title} className="h-full w-full object-cover" />
                </picture>
              </a>
            ) : banners !== null ? (
              <>
                <div className="hidden md:block">
                  <AdFrame id="leaderboard" />
                </div>
                <div className="md:hidden">
                  <AdFrame id="mobileBanner" />
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
      {/* The fold tab, in the flow under the band so it never covers the page. */}
      <button
        type="button"
        onClick={() => setFolded((f) => !f)}
        aria-label={folded ? "Show banner" : "Hide banner"}
        aria-expanded={!folded}
        className="inline-flex h-7 items-center rounded-b-md border border-t-0 border-brand-border bg-brand-card/60 px-3 text-gray-400 hover:text-gray-100"
      >
        {folded ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronUp aria-hidden className="h-4 w-4" />}
      </button>
    </aside>
  );
}
