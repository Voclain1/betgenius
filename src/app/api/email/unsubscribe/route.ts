import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readUnsubscribeToken } from "@/lib/mail/unsubscribe";

/**
 * Unsubscribe without signing in.
 *
 * Two callers: the button on /email/unsubscribe (JSON body), and a mail app's
 * own Unsubscribe button, which POSTs `List-Unsubscribe=One-Click` to the URL
 * in the List-Unsubscribe header with the token in the query (RFC 8058).
 *
 * POST only. A GET that unsubscribed would be triggered by the link scanners
 * many mail providers run over every incoming URL, unsubscribing people who
 * never clicked anything.
 *
 * The token is the whole authority: it is signed, names one user and one
 * preference, and can only ever turn that preference off.
 */
export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get("t");
  if (!token && req.headers.get("content-type")?.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { t?: unknown } | null;
    token = typeof body?.t === "string" ? body.t : null;
  }
  const parsed = readUnsubscribeToken(token);
  if (!parsed) return NextResponse.json({ error: "This unsubscribe link is not valid." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { id: true } });
  // A deleted account has nothing left to unsubscribe from; say it worked.
  if (user) {
    await prisma.emailPreference.upsert({
      where: { userId: parsed.userId },
      update: { [parsed.kind]: false },
      create: { userId: parsed.userId, [parsed.kind]: false },
    });
  }
  return NextResponse.json({ unsubscribed: parsed.kind });
}
