import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const Body = z.object({ action: z.enum(["APPROVE", "REVOKE"]) });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isSuperAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const role = parsed.data.action === "APPROVE" ? "ADMIN" : "USER";
  const user = await prisma.user.update({ where: { id: params.id }, data: { role } });
  return NextResponse.json({ user });
}
