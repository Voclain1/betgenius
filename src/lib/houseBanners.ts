import type { Prisma } from "@prisma/client";

/**
 * House banners: the top banner slot's own inventory (HouseBanner in
 * schema.prisma), managed at /admin/banners and shown by
 * src/components/ads/TopBanner.tsx on every page that carries ads.
 *
 * THE SLOT IS ONE FIXED SIZE, whatever fills it: 728x90 from md up, and a
 * full-width 16:5 box (320x100 at its narrowest) on a phone. A house banner
 * fills it; with none live, the Adsterra 728x90 / 320x50 sits centred in the
 * same box. Because the box never changes size, deciding what fills it after
 * the page has painted costs no layout shift, so pages keep whatever static
 * or cached rendering they already have.
 *
 * Pure helpers here, so the rules are checked without a database
 * (scripts/check-house-banners.ts).
 */

/** Largest image accepted, per creative. A 1456x180 banner is well under this. */
export const BANNER_MAX_BYTES = 1_000_000;

/** Upload guidance shown in the admin form: twice the slot size, for sharp phones. */
export const BANNER_DESKTOP_SIZE = { width: 1456, height: 180 } as const;
export const BANNER_MOBILE_SIZE = { width: 640, height: 200 } as const;

export type BannerImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/**
 * The image's real type, from its first bytes rather than its file name or the
 * browser's claim. Null for anything else (SVG included: it can carry script).
 */
export function sniffImageType(bytes: Uint8Array): BannerImageType | null {
  const at = (i: number, ...want: number[]) => want.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** A click may only lead to an ordinary web page. */
export function isSafeLinkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Shown now: switched on and inside its run dates, when it has any. */
export function isLiveBanner(b: { active: boolean; startsAt: Date | null; endsAt: Date | null }, now: Date = new Date()): boolean {
  if (!b.active) return false;
  if (b.startsAt && b.startsAt > now) return false;
  if (b.endsAt && b.endsAt <= now) return false;
  return true;
}

/** The same rule as a query. */
export function liveBannersWhere(now: Date = new Date()): Prisma.HouseBannerWhereInput {
  return {
    active: true,
    AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
}

/** What the slot needs to show a banner. No image bytes: those come from the image route. */
export type PublicBanner = { id: string; title: string; sponsored: boolean; hasMobile: boolean; version: number };

export function bannerImageSrc(b: PublicBanner, size: "desktop" | "mobile"): string {
  return `/api/banners/${b.id}/image?size=${size}&v=${b.version}`;
}

/** One banner per page view, so several live banners share the slot. */
export function pickBanner<T>(banners: readonly T[], random: () => number = Math.random): T | null {
  if (banners.length === 0) return null;
  return banners[Math.min(banners.length - 1, Math.floor(random() * banners.length))];
}

/** What the admin list says about a banner. Pure. */
export function bannerStatus(b: { active: boolean; startsAt: Date | null; endsAt: Date | null }, now: Date = new Date()): "Live" | "Scheduled" | "Ended" | "Off" {
  if (!b.active) return "Off";
  if (b.endsAt && b.endsAt <= now) return "Ended";
  if (b.startsAt && b.startsAt > now) return "Scheduled";
  return "Live";
}
