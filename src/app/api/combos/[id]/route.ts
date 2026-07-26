import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";

// Public — feeds BetBuilderClient's ?combo=<id> load-into-slip flow and any
// other client-side combo detail fetch. Same gating as everywhere else:
// category metadata is fetched first, legs only once the viewer is confirmed
// allowed to see them — a locked combo's picks never leave the server.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const meta = await prisma.combo.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, description: true, category: true, published: true },
  });
  if (!meta || !meta.published) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canView = canViewCategory(
    meta.category as PredictionCategory,
    session?.user.tier,
    session?.user.subStatus,
    session?.user.role,
  );
  if (!canView) return NextResponse.json({ error: "Locked" }, { status: 403 });

  const legs = await prisma.comboLeg.findMany({
    where: { comboId: meta.id },
    orderBy: { order: "asc" },
    select: { id: true, matchLabel: true, market: true, pick: true, odds: true },
  });

  return NextResponse.json({
    combo: { id: meta.id, title: meta.title, description: meta.description, category: meta.category, legs },
  });
}
