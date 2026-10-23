import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Liveness for the self-hosted deploy (deploy/deploy.sh) and the uptime
 * monitor: 200 only when the app answers AND the database does. The deploy
 * rolls back to the previous image when this does not turn 200, so it must
 * stay cheap and must not touch the football provider or any quota.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
