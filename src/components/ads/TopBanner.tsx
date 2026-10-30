"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp } from "lucide-react";
import { AdFrame } from "@/components/ads/AdUnit";
import { bannerImageSrc, pickBanner, type PublicBanner } from "@/lib/houseBanners";
import { TOP_BANNER_CLOSED_ATTR, TOP_BANNER_CLOSED_KEY, TOP_BANNER_HOUSE_ATTR, TOP_BANNER_HOUSE_KEY, TOP_BANNER_SLOT_ID } from "@/lib/topBanner";

/**
 * The top banner: flush under the header, full width, no frame, with a small
 * tab hanging below it to close it. Closed, the page is exactly what it is
 * without a banner, for the rest of the visit.
 *
 * WHERE IT DRAWS. Not here: into the slot the public layout keeps right after
 * the header (src/lib/topBanner.ts). What this renders in the page is a hidden
 * marker, which is what gives the slot its height (globals.css) from the
 * server HTML onward, so the banner arriving after hydration moves nothing.
 *
 * WHAT FILLS IT. A house banner from /admin/banners when one is live (several
 * take turns, one per page view); otherwise the Adsterra leaderboard, 728x90
 * from md up and 320x50 on a phone, centred in the same space.
 *
 * Mounted only where ads already are (the files that mount AdStickyMobile),
 * so the ad-free routes stay ad-free; it lives in components/ads so
 * scripts/check-ad-placement.ts walks it like every other slot.
 */
export function TopBanner() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [closed, setClosed] = useState(false);
  const [banners, setBanners] = useState<PublicBanner[] | null>(null);
  const [banner, setBanner] = useState<PublicBanner | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setClosed(document.documentElement.hasAttribute(TOP_BANNER_CLOSED_ATTR));
    setSlot(document.getElementById(TOP_BANNER_SLOT_ID));
  }, []);

  useEffect(() => {
    if (closed) return;
    let cancelled = false;
    fetch("/api/banners")
      .then((r) => (r.ok ? r.json() : { banners: [] }))
      .then((j: { banners?: PublicBanner[] }) => {
        if (cancelled) return;
        const list = Array.isArray(j.banners) ? j.banners : [];
        setBanners(list);
        const picked = pickBanner(list);
        setBanner(picked);
        // A house banner needs the taller phone box; remembered so the next
        // page reserves the right height before paint.
        const root = document.documentElement;
        try {
          if (picked) window.sessionStorage.setItem(TOP_BANNER_HOUSE_KEY, "1");
          else window.sessionStorage.removeItem(TOP_BANNER_HOUSE_KEY);
        } catch {
          // Height is then decided per page only.
        }
        if (picked) root.setAttribute(TOP_BANNER_HOUSE_ATTR, "");
        else root.removeAttribute(TOP_BANNER_HOUSE_ATTR);
      })
      .catch(() => !cancelled && setBanners([]));
    return () => {
      cancelled = true;
    };
  }, [closed]);

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
  }, [banner, slot]);

  const close = () => {
    // The attribute is what collapses the slot (globals.css); storage keeps it
    // closed on the next page, read before paint by TOP_BANNER_INIT_SCRIPT.
    document.documentElement.setAttribute(TOP_BANNER_CLOSED_ATTR, "");
    try {
      window.sessionStorage.setItem(TOP_BANNER_CLOSED_KEY, "1");
    } catch {
      // Closed for this page only.
    }
    setClosed(true);
  };

  // A paid banner, and every network ad, is marked as an ad; our own promotion is not.
  const isAd = banner ? banner.sponsored : banners !== null;

  const content = (
    <aside aria-label={banner && !banner.sponsored ? "Promotion" : "Advertisement"} className="absolute inset-0">
      <div ref={box} data-top-banner className="flex h-full w-full items-center justify-center overflow-hidden bg-brand-card">
        {banner ? (
          <a
            href={`/api/banners/${banner.id}/click`}
            target="_blank"
            rel={banner.sponsored ? "sponsored noopener" : "noopener"}
            className="block h-full w-full md:w-[728px]"
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
      {/* The close tab hangs below the banner, over the page's own top
          padding, so it takes no space of its own. It also carries the
          "Ad" disclosure, keeping the creative itself clear. Right-hand side,
          clear of the back button at the top left of the page. */}
      <button
        type="button"
        onClick={close}
        aria-label="Close banner"
        className="absolute right-4 top-full z-30 inline-flex h-6 items-center gap-1 rounded-b-md bg-brand-card px-2.5 text-[11px] font-medium text-gray-400 shadow-sm hover:text-gray-100"
      >
        {isAd && <span>Ad</span>}
        <ChevronUp aria-hidden className="h-3.5 w-3.5" />
      </button>
    </aside>
  );

  return (
    <>
      {/* The marker that reserves the slot's height. `hidden`: it takes no
          space in the page and is skipped by space-y stacks. Gone once
          closed, which collapses the slot. */}
      {!closed && <span hidden data-top-banner-page />}
      {!closed && slot ? createPortal(content, slot) : null}
    </>
  );
}
