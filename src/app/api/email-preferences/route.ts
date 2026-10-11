import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";

/**
 * The signed-in user's email choices. Only the optional kinds are settable;
 * receipts, payment problems and renewal reminders are about the account and
 * always go out. See docs/EMAIL.md.
 */
const Preferences = z.object({
  dailyPicks: z.boolean().optional(),
  announcements: z.boolean().optional(),
});

const DEFAULTS = { dailyPicks: true, announcements: true };

async function currentUserId() {
  return (await getServerSession(authOptions))?.user.id;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Read without creating: no row simply means the defaults.
  const row = await prisma.emailPreference.findUnique({ where: { userId }, select: { dailyPicks: true, announcements: true } });
  return NextResponse.json({ preferences: row ?? DEFAULTS });
}

export async function PATCH(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = Preferences.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
  const preferences = await prisma.emailPreference.upsert({
    where: { userId },
    update: parsed.data,
    create: { userId, ...parsed.data },
    select: { dailyPicks: true, announcements: true },
  });
  return NextResponse.json({ preferences });
}
