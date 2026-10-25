import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSafeLinkUrl } from "@/lib/houseBanners";

export const dynamic = "force-dynamic";

/** Counts a click on a house banner and sends the reader on to its link. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const home = new URL("/", req.url);
  try {
    const b = await prisma.houseBanner.update({ where: { id: params.id }, data: { clicks: { increment: 1 } }, select: { linkUrl: true } });
    return NextResponse.redirect(isSafeLinkUrl(b.linkUrl) ? b.linkUrl : home, 302);
  } catch {
    return NextResponse.redirect(home, 302);
  }
}
