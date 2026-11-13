import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PREDICTION_CATEGORIES } from "@/lib/enums";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
import { rateLimit, ACCOUNT_WRITE_LIMIT } from "@/lib/rateLimit";
import { PRIVATE_HEADERS } from "@/lib/accountApi";

/** Per-user ceiling across every follow type. Far above real use; stops scripted growth. */
const MAX_FOLLOWS = 300;

function limited(userId: string) {
  const r = rateLimit(`follows:${userId}`, ACCOUNT_WRITE_LIMIT.limit, ACCOUNT_WRITE_LIMIT.windowMs);
  return r.ok ? null : NextResponse.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "retry-after": String(r.retryAfterSeconds) } });
}

const Follow = z.object({
  targetType: z.enum(["TEAM", "LEAGUE", "PREDICTION", "CATEGORY"]),
  targetKey: z.string().min(1).max(100),
  label: z.string().trim().max(120).optional(),
});

async function currentUserId() {
  return (await getServerSession(authOptions))?.user?.id;
}

/** Keys must be the stable identifiers dispatch matches on: provider ids, a published tip, or a canonical category. */
async function validTarget(v: z.infer<typeof Follow>) {
  if ((v.targetType === "TEAM" || v.targetType === "LEAGUE") && !/^\d+$/.test(v.targetKey)) return false;
  if (v.targetType === "CATEGORY" && !(PREDICTION_CATEGORIES as readonly string[]).includes(v.targetKey)) return false;
  if (v.targetType === "PREDICTION") return !!(await prisma.prediction.findFirst({ where: { id: v.targetKey, status: "PUBLISHED" }, select: { id: true } }));
  return true;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const follows = await prisma.userFollow.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ follows }, { headers: PRIVATE_HEADERS });
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const tooMany = limited(userId);
  if (tooMany) return tooMany;
  const parsed = Follow.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await validTarget(parsed.data))) return NextResponse.json({ error: "Invalid follow target" }, { status: 400 });
  const { targetType, targetKey, label } = parsed.data;
  const exists = await prisma.userFollow.findUnique({ where: { userId_targetType_targetKey: { userId, targetType, targetKey } }, select: { id: true } });
  if (!exists && (await prisma.userFollow.count({ where: { userId } })) >= MAX_FOLLOWS) {
    return NextResponse.json({ error: `You can follow up to ${MAX_FOLLOWS} items` }, { status: 409 });
  }
  const follow = await prisma.userFollow.upsert({
    where: { userId_targetType_targetKey: { userId, targetType, targetKey } },
    update: { label },
    create: { userId, targetType, targetKey, label },
  });
  return NextResponse.json({ follow }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasValidMutationOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const tooManyRemovals = limited(userId);
  if (tooManyRemovals) return tooManyRemovals;
  const parsed = Follow.pick({ targetType: true, targetKey: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  await prisma.userFollow.deleteMany({ where: { userId, ...parsed.data } });
  return NextResponse.json({ ok: true });
}
