import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { BANNER_MAX_BYTES, isSafeLinkUrl, sniffImageType } from "@/lib/houseBanners";

export const dynamic = "force-dynamic";

/** Every banner, newest first, without its image bytes. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const banners = await prisma.houseBanner.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, linkUrl: true, sponsored: true, active: true, startsAt: true, endsAt: true,
      views: true, clicks: true, mobileImageType: true, createdAt: true, updatedAt: true,
    },
  });
  return NextResponse.json({ banners: banners.map(({ mobileImageType, ...b }) => ({ ...b, hasMobile: !!mobileImageType })) });
}

async function readImage(file: FormDataEntryValue | null, label: string): Promise<{ bytes: Buffer; type: string } | { error: string } | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > BANNER_MAX_BYTES) return { error: `The ${label} image is over 1 MB. Export it smaller and try again.` };
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return { error: `The ${label} image must be a PNG, JPG, WebP or GIF.` };
  return { bytes, type };
}

const date = (v: FormDataEntryValue | null) => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
};

/** A new banner, from the admin form (multipart: title, linkUrl, image, mobileImage?, sponsored, startsAt?, endsAt?). */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the form as an upload." }, { status: 400 });

  const title = String(form.get("title") ?? "").trim();
  const linkUrl = String(form.get("linkUrl") ?? "").trim();
  if (!title) return NextResponse.json({ error: "Give the banner a name." }, { status: 400 });
  if (!isSafeLinkUrl(linkUrl)) return NextResponse.json({ error: "The link must be a full web address starting with https://" }, { status: 400 });

  const image = await readImage(form.get("image"), "desktop");
  if (!image) return NextResponse.json({ error: "Choose the desktop image." }, { status: 400 });
  if ("error" in image) return NextResponse.json({ error: image.error }, { status: 400 });
  const mobile = await readImage(form.get("mobileImage"), "phone");
  if (mobile && "error" in mobile) return NextResponse.json({ error: mobile.error }, { status: 400 });

  const startsAt = date(form.get("startsAt"));
  const endsAt = date(form.get("endsAt"));
  if (startsAt === undefined || endsAt === undefined) return NextResponse.json({ error: "A run date is not a valid date." }, { status: 400 });
  if (startsAt && endsAt && endsAt <= startsAt) return NextResponse.json({ error: "The end date must be after the start date." }, { status: 400 });

  const banner = await prisma.houseBanner.create({
    data: {
      title,
      linkUrl,
      image: image.bytes,
      imageType: image.type,
      mobileImage: mobile ? mobile.bytes : null,
      mobileImageType: mobile ? mobile.type : null,
      sponsored: form.get("sponsored") !== "false",
      startsAt,
      endsAt,
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: banner.id });
}
