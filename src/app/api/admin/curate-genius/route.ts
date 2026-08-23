import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { curateAutomaticTips } from "@/lib/geniusCuration";

export const dynamic = "force-dynamic";

async function isAuthorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await getServerSession(authOptions);
  return isAdmin(session?.user.role);
}

/** Lightweight, independently callable form of the curation step used by settlement. */
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await curateAutomaticTips());
}
