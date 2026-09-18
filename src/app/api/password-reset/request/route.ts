import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createResetToken } from "@/lib/passwordReset";
import { passwordResetEmail, sendEmail } from "@/lib/email";

const Body = z.object({ email: z.string().email() });

/**
 * Ask for a reset link.
 *
 * ALWAYS ANSWERS THE SAME WAY. Whether the address has an account, has only
 * ever signed in with Google, or has never been seen here, the response is an
 * identical 200. Registration already leaks membership through its 409 (worth
 * fixing separately); this endpoint is not going to add a second, quieter way
 * to enumerate the user list.
 *
 * A Google-only account has no password to reset — there is no passwordHash to
 * sign a token against — so nothing is sent. Telling the requester that would
 * disclose both that the account exists and how its owner signs in.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  // Even a malformed body gets the same shape back, for the same reason.
  if (!parsed.success) return NextResponse.json({ ok: true });

  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });

  if (user?.passwordHash) {
    const token = createResetToken(user.id, user.passwordHash);
    const base = process.env.NEXTAUTH_URL ?? "";
    const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
    const { subject, html, text } = passwordResetEmail(link);
    const result = await sendEmail({ to: email, subject, html, text });
    if (!result.delivered) {
      // Logged, not surfaced: the requester is told the same thing either way,
      // and this is the line that lets support hand over a link by hand.
      console.error("Password reset email not delivered", { reason: result.reason, link });
    }
  }

  return NextResponse.json({ ok: true });
}
