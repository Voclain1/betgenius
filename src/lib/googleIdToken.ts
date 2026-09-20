import { OAuth2Client } from "google-auth-library";

/**
 * Verification of a Google Identity Services ID token.
 *
 * THE RULE: nothing downstream may look at a claim this function has not
 * verified. A One Tap credential arrives as a JWT in a request body, which
 * means it arrives from an attacker just as easily as from Google — and a JWT
 * is base64, not a secret. `JSON.parse(atob(token.split(".")[1]))` yields a
 * perfectly well-formed payload naming any email the sender likes. Decoding is
 * not authentication, and the gap between the two is a total account takeover
 * of every user on the site.
 *
 * So this delegates to google-auth-library's verifyIdToken, which fetches
 * Google's published JWKS, checks the RS256 SIGNATURE against the key named by
 * the token's `kid`, and rejects on a bad signature, a wrong `aud`, a wrong
 * `iss` or an expired `exp`. Those four are the whole security boundary:
 *
 *   signature — the token was minted by Google and not edited in flight.
 *   aud       — minted for THIS application. Without it, a token issued to any
 *               other Google client is accepted here, and anyone with their own
 *               Google app could sign in as anyone.
 *   iss       — accounts.google.com, so a valid token from elsewhere cannot pass.
 *   exp       — still live, so a captured token is not usable indefinitely.
 *
 * On top of those, `email_verified` is required here. Google will mint a token
 * for an unverified address on some account types, and treating one as proof of
 * an email would let someone claim an address they do not control — which, on
 * this site, is how you would take over an existing BetGenius account.
 *
 * The library is declared as a direct dependency rather than relied on
 * transitively through @google/genai: a transitive package can be moved or
 * dropped by an unrelated upgrade, and this is not a file that should stop
 * verifying because something else changed its dependency tree.
 */

export type VerifiedGoogleIdentity = {
  /** Google's stable, immutable user id. The identity — an email can change, this cannot. */
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export type GoogleIdTokenResult =
  | { ok: true; identity: VerifiedGoogleIdentity }
  | { ok: false; reason: "unconfigured" | "invalid" | "unverified-email" | "no-email" };

/** Cached across invocations — the library keeps Google's JWKS warm, so this avoids refetching per sign-in. */
let client: OAuth2Client | null = null;

function clientFor(clientId: string) {
  if (!client) client = new OAuth2Client(clientId);
  return client;
}

/**
 * Verifies a credential and returns the identity it proves, or why it does not.
 *
 * Never throws: a malformed token is an expected input on a public endpoint,
 * not an exceptional one, and a rejected sign-in must not become a 500. The
 * reason is deliberately coarse — the caller turns every failure into the same
 * generic response, because telling a prober which check failed helps only them.
 */
export async function verifyGoogleIdToken(credential: unknown): Promise<GoogleIdTokenResult> {
  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) return { ok: false, reason: "unconfigured" };
  if (typeof credential !== "string" || credential.length < 20 || credential.length > 8192) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const ticket = await clientFor(audience).verifyIdToken({ idToken: credential, audience });
    const payload = ticket.getPayload();
    if (!payload) return { ok: false, reason: "invalid" };

    // Re-asserted here even though verifyIdToken already enforces it. This is
    // the claim that decides WHICH application the token was for, and it costs
    // one comparison to be certain a library upgrade cannot quietly relax it.
    if (payload.aud !== audience) return { ok: false, reason: "invalid" };
    if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
      return { ok: false, reason: "invalid" };
    }
    if (!payload.exp || payload.exp * 1000 <= Date.now()) return { ok: false, reason: "invalid" };
    if (!payload.sub) return { ok: false, reason: "invalid" };

    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email) return { ok: false, reason: "no-email" };
    // Google mints tokens for unverified addresses on some account types.
    // Accepting one would let a caller claim an address they do not control.
    if (payload.email_verified !== true) return { ok: false, reason: "unverified-email" };

    return {
      ok: true,
      identity: {
        sub: payload.sub,
        email,
        name: typeof payload.name === "string" ? payload.name : null,
        picture: typeof payload.picture === "string" ? payload.picture : null,
      },
    };
  } catch {
    // Bad signature, expired, wrong audience, unreachable JWKS — all the same
    // answer to the caller: this credential did not prove anything.
    return { ok: false, reason: "invalid" };
  }
}
