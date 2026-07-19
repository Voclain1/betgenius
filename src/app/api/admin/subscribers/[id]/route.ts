import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const Body = z.object({
  action: z.enum(["APPROVE", "CANCEL", "SET_TIER"]),
  tier: z.enum(["FREE", "VIP", "PREMIUM"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, tier } = parsed.data;

  const data: any = {};
  if (action === "APPROVE") {
    data.status = "ACTIVE";
    data.approvedById = session!.user.id;
    data.approvedAt = new Date();
    if (tier) data.tier = tier;
  } else if (action === "CANCEL") {
    data.status = "CANCELED";
  } else if (action === "SET_TIER" && tier) {
    data.tier = tier;
  }

  const sub = await prisma.subscription.update({ where: { id: params.id }, data });
  return NextResponse.json({ subscription: sub });
}
