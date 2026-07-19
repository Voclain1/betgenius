import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { setPredictionCategories } from "@/lib/predictions";
import { z } from "zod";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const prediction = await prisma.prediction.findUnique({
    where: { id: params.id },
    include: {
      categories: true,
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
      author: { select: { name: true, email: true } },
    },
  });
  if (!prediction) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ prediction });
}

const Patch = z.object({
  action: z.enum(["APPROVE", "PUBLISH", "ARCHIVE", "EDIT"]),
  patch: z
    .object({
      market: z.string().optional(),
      pick: z.string().optional(),
      overUnder: z.string().optional(),
      odds: z.number().optional(),
      confidence: z.number().min(0).max(100).optional(),
      reasoning: z.string().optional(),
      matchPreview: z.string().optional(),
      categories: z.array(z.enum(["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"])).min(1).optional(),
      leagueApiId: z.number().nullable().optional(),
      leagueName: z.string().nullable().optional(),
      homeTeam: z.string().nullable().optional(),
      awayTeam: z.string().nullable().optional(),
      kickoff: z.coerce.date().nullable().optional(),
    })
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, patch } = parsed.data;

  const { categories, ...rest } = patch ?? {};
  const data: any = { ...rest };
  if (action === "APPROVE") {
    data.status = "APPROVED";
    data.approvedById = session!.user.id;
    data.approvedAt = new Date();
  } else if (action === "PUBLISH") {
    data.status = "PUBLISHED";
    data.publishedAt = new Date();
    if (!data.approvedById) {
      data.approvedById = session!.user.id;
      data.approvedAt = new Date();
    }
  } else if (action === "ARCHIVE") {
    data.status = "ARCHIVED";
  }

  if (categories) await setPredictionCategories(params.id, categories);
  const updated = await prisma.prediction.update({
    where: { id: params.id },
    data,
    include: { categories: true },
  });
  return NextResponse.json({ prediction: updated });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.prediction.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
