/**
 * Password-reset token contract.
 *
 * The token IS the security of this feature — there is no table backing it, so
 * every property it claims (unguessable, expiring, single-use, bound to one
 * account) has to hold in the signature itself. These assert exactly that.
 */
import assert from "node:assert/strict";

process.env.NEXTAUTH_SECRET ??= "test-secret-for-password-reset-checks";

import { createResetToken, readTokenClaim, verifyResetToken } from "../src/lib/passwordReset";

const NOW = new Date("2026-09-18T12:00:00Z");
const HASH = "$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890";
const OTHER_HASH = "$2a$10$zyxwvutsrqponmlkjihgfedcba987654321098765432109";
const USER = "user_reset_1";

// A freshly minted link works, and names the account it was minted for.
const token = createResetToken(USER, HASH, NOW);
const ok = verifyResetToken(token, HASH, NOW);
assert.equal(ok.valid, true, "a fresh token verifies");
assert.equal(ok.valid && ok.userId, USER, "a token names its user");
assert.equal(readTokenClaim(token)?.userId, USER, "the claim is readable before verification");

// Single-use: resetting the password changes the hash, which kills the link
// that did it — and any other link issued against the old hash.
const afterReset = verifyResetToken(token, OTHER_HASH, NOW);
assert.equal(afterReset.valid, false, "a used link stops working once the password changes");
assert.equal(!afterReset.valid && afterReset.reason, "SIGNATURE");

const alsoIssuedEarlier = createResetToken(USER, HASH, NOW);
assert.equal(
  verifyResetToken(alsoIssuedEarlier, OTHER_HASH, NOW).valid,
  false,
  "every link issued against the old hash dies with it",
);

// Expiry, and the fact that it is signed rather than merely stated.
const anHourAndABitLater = new Date(NOW.getTime() + 61 * 60 * 1000);
const expired = verifyResetToken(token, HASH, anHourAndABitLater);
assert.equal(expired.valid, false, "a token past its hour is refused");
assert.equal(!expired.valid && expired.reason, "EXPIRED");
assert.equal(
  verifyResetToken(token, HASH, new Date(NOW.getTime() + 59 * 60 * 1000)).valid,
  true,
  "a token inside its hour still works",
);

const [claimedUser, , signature] = Buffer.from(token, "base64url").toString("utf8").split(".");
const stretched = Buffer.from(
  `${claimedUser}.${NOW.getTime() + 10 * 365 * 24 * 3600 * 1000}.${signature}`,
).toString("base64url");
assert.equal(
  verifyResetToken(stretched, HASH, anHourAndABitLater).valid,
  false,
  "moving the expiry invalidates the signature — the deadline is signed, not declared",
);

// Bound to one account: a valid token cannot be pointed at someone else.
const swapped = Buffer.from(`another_user.${readTokenClaim(token)!.expiresAt}.${signature}`).toString("base64url");
assert.equal(verifyResetToken(swapped, HASH, NOW).valid, false, "a token cannot be repointed at another account");

// Unforgeable without the key.
const forged = Buffer.from(`${USER}.${NOW.getTime() + 3600_000}.${"a".repeat(43)}`).toString("base64url");
assert.equal(verifyResetToken(forged, HASH, NOW).valid, false, "a made-up signature is refused");

// Malformed input is refused, not thrown on — these arrive from a URL.
for (const bad of ["", "not-base64!!", Buffer.from("only.two").toString("base64url"), "e30"]) {
  const verdict = verifyResetToken(bad, HASH, NOW);
  assert.equal(verdict.valid, false, `malformed token refused: ${JSON.stringify(bad)}`);
}
assert.equal(readTokenClaim("not-a-token")?.userId, undefined, "an unreadable token yields no claim");

// A signature of a different length must not throw (timingSafeEqual does).
assert.equal(
  verifyResetToken(Buffer.from(`${USER}.${NOW.getTime() + 3600_000}.short`).toString("base64url"), HASH, NOW).valid,
  false,
  "a short signature is refused rather than throwing",
);

console.log(
  "Password reset checks passed: fresh token verifies; used and superseded links die with the old hash; " +
    "expiry enforced and signed; tokens bound to one account; forged, malformed and mis-sized signatures refused.",
);
