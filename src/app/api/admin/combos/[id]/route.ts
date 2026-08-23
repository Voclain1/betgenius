import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { setComboLegs } from "@/lib/combos";
import { z } from "zod";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const combo = await prisma.combo.findUnique({
    where: { id: params.id },
    include: { legs: { orderBy: { order: "asc" } } },
  });
  if (!combo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ combo });
}

const Patch = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.enum(["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"]).optional(),
  published: z.boolean().optional(),
  legs: z
    .array(
      z.object({
        matchLabel: z.string().min(1),
        market: z.string().min(1),
        pick: z.string().min(1),
        predictionId: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { legs, ...patch } = parsed.data;

  if (Object.keys(patch).length > 0) {
    await prisma.combo.update({ where: { id: params.id }, data: patch });
  }
  if (legs) await setComboLegs(params.id, legs);

  const combo = await prisma.combo.findUnique({
    where: { id: params.id },
    include: { legs: { orderBy: { order: "asc" } } },
  });
  return NextResponse.json({ combo });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.combo.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
