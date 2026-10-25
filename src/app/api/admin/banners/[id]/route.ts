import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { isSafeLinkUrl } from "@/lib/houseBanners";

export const dynamic = "force-dynamic";

const Patch = z.object({
  title: z.string().trim().min(1).optional(),
  linkUrl: z.string().trim().refine(isSafeLinkUrl, "The link must be a full web address starting with https://").optional(),
  active: z.boolean().optional(),
  sponsored: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

/** Edit a banner's details or switch it on or off. Images are replaced by uploading a new banner. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  const { startsAt, endsAt, ...rest } = parsed.data;
  const data = {
    ...rest,
    ...(startsAt !== undefined ? { startsAt: startsAt ? new Date(startsAt) : null } : {}),
    ...(endsAt !== undefined ? { endsAt: endsAt ? new Date(endsAt) : null } : {}),
  };
  const updated = await prisma.houseBanner.updateMany({ where: { id: params.id }, data });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.houseBanner.deleteMany({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
