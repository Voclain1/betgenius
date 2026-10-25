import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * A house banner's image. The URL carries the banner's version (?v=updatedAt),
 * so the response can be cached for a year: an edited banner gets a new URL.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const mobile = new URL(req.url).searchParams.get("size") === "mobile";
  const b = await prisma.houseBanner.findUnique({
    where: { id: params.id },
    select: mobile ? { mobileImage: true, mobileImageType: true, image: true, imageType: true } : { image: true, imageType: true },
  });
  if (!b) return new Response("Not found", { status: 404 });
  const row = b as { image: Uint8Array; imageType: string; mobileImage?: Uint8Array | null; mobileImageType?: string | null };
  const bytes = mobile && row.mobileImage ? row.mobileImage : row.image;
  const type = mobile && row.mobileImage ? row.mobileImageType! : row.imageType;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
