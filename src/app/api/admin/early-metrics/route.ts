import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { getEarlyLaneMetrics } from "@/lib/earlyLaneMetrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin-only lead-time, preview and sitemap indicators (issue #237). Read-only; no provider calls. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await getEarlyLaneMetrics());
}
