import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";

const minuteOfDay = z.number().int().min(0).max(1439).nullable();

const Preferences = z.object({
  pushEnabled: z.boolean().optional(),
  newPredictions: z.boolean().optional(),
  // The two audience switches. Independent of each other and of
  // kickoffReminders — see preferenceAllows in src/lib/notifications.ts.
  followedAlerts: z.boolean().optional(),
  editorialAlerts: z.boolean().optional(),
  kickoffReminders: z.boolean().optional(),
  tipChanges: z.boolean().optional(),
  results: z.boolean().optional(),
  kickoffMinutes: z.number().int().min(5).max(180).optional(),
  timezone: z.string().min(1).max(80).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }).optional(),
  quietStartMinutes: minuteOfDay.optional(),
  quietEndMinutes: minuteOfDay.optional(),
  dailyCap: z.number().int().min(1).max(50).optional(),
});

async function currentUserId() {
  return (await getServerSession(authOptions))?.user.id;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const preferences = await prisma.notificationPreference.upsert({ where: { userId }, update: {}, create: { userId } });
  return NextResponse.json({ preferences });
}

export async function PATCH(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = Preferences.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
  const preferences = await prisma.notificationPreference.upsert({ where: { userId }, update: parsed.data, create: { userId, ...parsed.data } });
  return NextResponse.json({ preferences });
}
