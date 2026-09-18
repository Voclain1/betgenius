import crypto from "crypto";

/**
 * Password-reset tokens, without a table to store them in.
 *
 * A reset link has to be unguessable, expire, and work exactly once. The usual
 * way is a row per request, which brings a migration, an index, and a job to
 * sweep up rows nobody ever clicked. None of that is needed here, because the
 * three properties can come from what the account already holds.
 *
 *   unguessable — the signature is an HMAC keyed by NEXTAUTH_SECRET. Nothing in
 *                 the link is secret on its own; without the key a signature
 *                 cannot be produced for a payload the server will accept.
 *
 *   expiring    — the expiry is inside the signed payload, so moving it
 *                 invalidates the signature.
 *
 *   single-use  — the CURRENT password hash is mixed into the signature. Using
 *                 a link changes that hash, so every link issued against the
 *                 old one stops verifying the moment the reset lands. That also
 *                 covers the case that matters most: a link that leaks from an
 *                 inbox later is already dead if it was used, and a password
 *                 changed by any other route kills outstanding links too.
 *
 * The token is opaque to the user but NOT a secret store: it carries a user id
 * and an expiry in the clear. That is fine — neither is sensitive, and neither
 * is trusted until the signature over them verifies.
 */

const TTL_MS = 60 * 60 * 1000; // one hour

export type TokenPayload = { userId: string; expiresAt: number };

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  // Refuse to mint or verify anything rather than fall back to a constant: an
  // empty key would make every signature forgeable by anyone reading this file.
  if (!value) throw new Error("NEXTAUTH_SECRET is required to sign password-reset tokens");
  return value;
}

function sign(userId: string, expiresAt: number, passwordHash: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`${userId}.${expiresAt}.${passwordHash}`)
    .digest("base64url");
}

export function createResetToken(userId: string, passwordHash: string, now: Date = new Date()): string {
  const expiresAt = now.getTime() + TTL_MS;
  return Buffer.from(`${userId}.${expiresAt}.${sign(userId, expiresAt, passwordHash)}`).toString("base64url");
}

/** The user id a token claims, before any signature is checked. */
export function readTokenClaim(token: string): TokenPayload | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAt] = parts;
  const expiry = Number(expiresAt);
  if (!userId || !Number.isFinite(expiry)) return null;
  return { userId, expiresAt: expiry };
}

export type TokenVerdict = { valid: true; userId: string } | { valid: false; reason: "MALFORMED" | "EXPIRED" | "SIGNATURE" };

/**
 * Verify a token against the account's CURRENT password hash.
 *
 * The caller loads the user by the id the token claims and passes the hash it
 * found; nothing is trusted until this returns valid.
 */
export function verifyResetToken(token: string, passwordHash: string, now: Date = new Date()): TokenVerdict {
  const claim = readTokenClaim(token);
  if (!claim) return { valid: false, reason: "MALFORMED" };

  const decoded = Buffer.from(token, "base64url").toString("utf8");
  const signature = decoded.split(".")[2];
  const expected = sign(claim.userId, claim.expiresAt, passwordHash);

  // Constant-time, and length-guarded because timingSafeEqual throws on a
  // length mismatch rather than returning false.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: "SIGNATURE" };

  // Checked after the signature so an attacker learns nothing from the
  // difference between "expired" and "not signed by us".
  if (claim.expiresAt <= now.getTime()) return { valid: false, reason: "EXPIRED" };

  return { valid: true, userId: claim.userId };
}
