import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { liveBannersWhere, type PublicBanner } from "@/lib/houseBanners";

export const dynamic = "force-dynamic";

/**
 * The house banners live now, for the top banner slot (src/lib/houseBanners.ts).
 * Cached at the edge for a minute, so the database sees about one read a
 * minute however busy the site is, and a banner switched on in admin shows
 * within that minute.
 */
export async function GET() {
  let banners: PublicBanner[] = [];
  try {
    const rows = await prisma.houseBanner.findMany({
      where: liveBannersWhere(),
      select: { id: true, title: true, sponsored: true, mobileImageType: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    });
    banners = rows.map((r) => ({ id: r.id, title: r.title, sponsored: r.sponsored, hasMobile: !!r.mobileImageType, version: r.updatedAt.getTime() }));
  } catch (err) {
    // No banners is a valid answer: the slot falls back to the network ad.
    console.error("[api/banners] could not read banners", err);
  }
  return NextResponse.json(
    { banners },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } },
  );
}
