import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const tasks = await prisma.adminTask.findMany({
    orderBy: { createdAt: "desc" },
    include: { assignedTo: true, createdBy: true },
  });
  return NextResponse.json({ tasks });
}

const Body = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedToId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const t = await prisma.adminTask.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      assignedToId: parsed.data.assignedToId,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      createdById: session!.user.id,
    },
  });
  return NextResponse.json({ task: t });
}
