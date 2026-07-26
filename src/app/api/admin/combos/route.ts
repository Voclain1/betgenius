import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const combos = await prisma.combo.findMany({
    orderBy: { createdAt: "desc" },
    include: { legs: { orderBy: { order: "asc" } } },
  });
  return NextResponse.json({ combos });
}

const Create = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"]),
  published: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Create.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const combo = await prisma.combo.create({ data: parsed.data, include: { legs: true } });
  return NextResponse.json({ combo });
}
