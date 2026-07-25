import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const bookmakers = await prisma.bookmaker.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ bookmakers });
}

const Create = z.object({
  name: z.string().min(1),
  logoUrl: z.string().url().nullable().optional(),
  affiliateUrl: z.string().url(),
  active: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Create.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const bookmaker = await prisma.bookmaker.create({ data: parsed.data });
  return NextResponse.json({ bookmaker });
}
