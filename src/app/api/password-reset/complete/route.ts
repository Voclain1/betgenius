import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { readTokenClaim, verifyResetToken } from "@/lib/passwordReset";

// Same floor as registration, so a password cannot be weakened by resetting it.
const Body = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

/**
 * Set a new password from a reset link.
 *
 * The token names a user; it is not believed until its signature verifies
 * against that user's CURRENT password hash. That is what makes a link
 * single-use — completing a reset changes the hash, so the link that did it no
 * longer verifies, and neither does any other link issued before it.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.success ? "Invalid request" : "Choose a password of at least 8 characters" },
      { status: 400 },
    );
  }

  const claim = readTokenClaim(parsed.data.token);
  const user = claim
    ? await prisma.user.findUnique({ where: { id: claim.userId }, select: { id: true, passwordHash: true } })
    : null;

  // One message for every way a link can fail — expired, tampered with, already
  // used, or naming an account that has no password. They are the same problem
  // to the person holding it, and distinguishing them tells an attacker which
  // user ids exist.
  if (!user?.passwordHash || verifyResetToken(parsed.data.token, user.passwordHash).valid !== true) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 10) },
  });

  return NextResponse.json({ ok: true });
}
