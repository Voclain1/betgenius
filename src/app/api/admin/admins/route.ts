import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin, isSuperAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "ADMIN_PENDING", "SUPER_ADMIN"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json({ admins });
}

/** SUPER_ADMIN can nominate a user for admin (sets role = ADMIN_PENDING). */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isSuperAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { email } = await req.json();
  const user = await prisma.user.update({
    where: { email: String(email).toLowerCase() },
    data: { role: "ADMIN_PENDING" },
  });
  return NextResponse.json({ user });
}
