import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const Item = z.object({ fixtureId: z.string(), market: z.string(), pick: z.string(), odds: z.number().positive() });
const Body = z.object({ items: z.array(Item).min(1), stake: z.number().min(0).default(0), name: z.string().optional() });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const totalOdds = parsed.data.items.reduce((acc, i) => acc * i.odds, 1);
  const slip = await prisma.betSlip.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name ?? "Bet builder",
      totalOdds,
      stake: parsed.data.stake,
      items: { create: parsed.data.items },
    },
    include: { items: true },
  });
  return NextResponse.json({ slip });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const slips = await prisma.betSlip.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { items: { include: { fixture: { include: { homeTeam: true, awayTeam: true } } } } },
    take: 25,
  });
  return NextResponse.json({ slips });
}
