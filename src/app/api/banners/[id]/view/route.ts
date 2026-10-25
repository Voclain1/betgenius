import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Counts one view of a house banner: sent once per page view, when the banner is on screen. */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  await prisma.houseBanner.updateMany({ where: { id: params.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
  return new Response(null, { status: 204 });
}
