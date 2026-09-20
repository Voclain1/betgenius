import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role, SubscriptionStatus, SubscriptionTier } from "@/lib/enums";
import { SESSION_COOKIE_NAME, useSecureAuthCookies } from "@/lib/authCookies";
import { verifyGoogleIdToken } from "@/lib/googleIdToken";

/**
 * The One Tap provider's id. Named here and imported by the client so the
 * string cannot drift between signIn() and the provider that answers it — a
 * mismatch fails as a silent "no such provider" with no error worth reading.
 */
export const GOOGLE_ONE_TAP_PROVIDER = "google-one-tap";

/**
 * The session cookie is pinned to the `__Host-` prefix in production.
 *
 * WHY, AND WHAT IT ACTUALLY PREVENTS. The ad frame is served from
 * ads.betgenius.ng so that third-party ad code sits on its own origin (see
 * src/lib/ads.ts). It cannot read anything of ours — that is enforced by the
 * Same Origin Policy and was measured — but any subdomain of betgenius.ng can
 * still SET a cookie scoped to `.betgenius.ng`, and such a cookie is sent to
 * www too. The ad network already does exactly that with its own tracking id.
 *
 * NextAuth's default name is `__Secure-next-auth.session-token`. The
 * `__Secure-` prefix only requires the Secure flag; it says nothing about
 * Domain. So a subdomain could set a `.betgenius.ng` cookie of that same
 * name, and www would then receive two cookies called the same thing with no
 * way to tell which is ours — cookie shadowing.
 *
 * `__Host-` closes that. A browser accepts a `__Host-` cookie ONLY when it
 * is Secure, has Path=/, and carries NO Domain attribute — which makes it
 * host-only by definition and unsettable by any subdomain. There is no way
 * for ads.betgenius.ng to write a `__Host-` cookie that www will read.
 *
 * THE PREFIX IS CONDITIONAL, AND MUST STAY THAT WAY. `__Host-` requires
 * Secure, and a Secure cookie is not stored over plain http — so hard-coding
 * the prefix would break sign-in on http://localhost with no error beyond a
 * login that silently never completes. The name therefore tracks
 * useSecureCookies, the same signal that decides the Secure flag itself.
 *
 * DO NOT ADD A `domain` OPTION HERE. A `__Host-` cookie carrying Domain is
 * rejected outright by the browser, so it would not weaken sign-in, it would
 * break it completely for every user. scripts/check-auth-cookies.ts asserts
 * that, along with Secure and Path.
 *
 * RENAMING THE COOKIE ENDS EVERY EXISTING SESSION once, on deploy: the old
 * `__Secure-` cookie is simply no longer the one being read. Signed-in users
 * are signed out and log in again; nothing is lost beyond that.
 *
 * THE NAME ITSELF LIVES IN src/lib/authCookies.ts, not here, because the
 * middleware has to read the same cookie and cannot import this file. Setting
 * it here while the middleware guessed the default is what broke every
 * protected route for signed-in users the first time this shipped.
 */

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Only the session cookie is named here. Every other NextAuth cookie keeps
  // its default: the CSRF token is already `__Host-` by default, and the
  // OAuth state/PKCE cookies are short-lived and scoped to the sign-in round
  // trip, so they do not carry the standing risk this addresses.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        // Both required by the `__Host-` prefix, and both what NextAuth would
        // have used anyway.
        path: "/",
        secure: useSecureAuthCookies,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({ where: { email: credentials.email.toLowerCase() } });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role as Role } as any;
      },
    }),
    /**
     * Google One Tap, bridged into the SAME user model as the button below.
     *
     * WHY A CREDENTIALS PROVIDER AT ALL. One Tap does not perform an OAuth
     * redirect: Google hands the browser a signed ID token directly, so there
     * is no authorization code for GoogleProvider to exchange. The token has to
     * be posted to us and verified server-side, and NextAuth's shape for "I
     * verified something myself" is a credentials provider.
     *
     * IT IS NOT A SECOND AUTH SYSTEM, and the three rules below are what keep
     * that true:
     *
     *   1. The SAME linking policy as the Google button. An email owned by a
     *      password account is refused here exactly as the signIn callback
     *      refuses it there. Silently merging would mean anyone who could get a
     *      Google token for an address could walk into the password account
     *      behind it.
     *   2. The SAME User rows. One Tap never invents a parallel identity: it
     *      finds the existing user by email, or creates one that is
     *      indistinguishable from an adapter-created one.
     *   3. An Account LINK ROW is always written. This is the subtle one. The
     *      adapter resolves OAuth sign-ins by (provider, providerAccountId); a
     *      user created here without that row would later hit the Google button
     *      and be refused as OAuthAccountNotLinked — locked out of their own
     *      account by the convenience feature that created it. Upserted on
     *      every One Tap sign-in, so a user who predates this also gains the
     *      link rather than needing one.
     *
     * `authorize` returns null for every failure. A caller learns only that the
     * sign-in did not happen, never which check refused it.
     */
    CredentialsProvider({
      id: GOOGLE_ONE_TAP_PROVIDER,
      name: "Google One Tap",
      credentials: { credential: { label: "Google credential", type: "text" } },
      async authorize(credentials) {
        // Verified before ANYTHING is read from it — signature, audience,
        // issuer, expiry, verified email. See lib/googleIdToken.ts.
        const verified = await verifyGoogleIdToken(credentials?.credential);
        if (!verified.ok) return null;
        const { sub, email, name, picture } = verified.identity;

        const existing = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, role: true, passwordHash: true },
        });

        // Rule 1 — identical to the signIn callback's policy for "google".
        if (existing?.passwordHash) return null;

        const user =
          existing ??
          (await prisma.user.create({
            data: {
              email,
              name,
              image: picture,
              // Google has verified the address; recording that keeps a One
              // Tap user shaped like an adapter-created one.
              emailVerified: new Date(),
              // Matches what /api/register gives a credentials signup, so a One
              // Tap account is not a user with no subscription row. (The plain
              // Google button does leave that null — the jwt callback below
              // already falls back to FREE/PENDING for it.)
              subscription: { create: { tier: "FREE", status: "ACTIVE" } },
            },
            select: { id: true, email: true, name: true, role: true, passwordHash: true },
          }));

        // Rule 3 — the link the adapter would have written.
        await prisma.account.upsert({
          where: { provider_providerAccountId: { provider: "google", providerAccountId: sub } },
          update: {},
          create: { userId: user.id, type: "oauth", provider: "google", providerAccountId: sub },
        });

        return { id: user.id, email: user.email, name: user.name, role: user.role as Role } as any;
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      // Deliberately NOT set (defaults to false) — see the signIn callback
      // below for why: a Google sign-in hitting an email that already has a
      // password-based account should surface a clear error, not silently
      // merge into that account.
      // allowDangerousEmailAccountLinking: false,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // BOTH Google paths, not just the redirect one. The One Tap provider
      // already refuses a password-owned email inside authorize(); repeating
      // the rule here means the policy lives where every other reader of this
      // file expects to find it, and a future provider that forgets it is
      // still caught. The two must never diverge — one of them being laxer is
      // an account takeover of the stricter one.
      if ((account?.provider === "google" || account?.provider === GOOGLE_ONE_TAP_PROVIDER) && user.email) {
        const existing = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { passwordHash: true },
        });
        // A password-based account already owns this email and has never
        // linked Google — block rather than let the adapter/NextAuth core
        // silently merge them. (A user who signed up via Google before has
        // passwordHash: null, so a repeat Google sign-in still passes here.)
        if (existing?.passwordHash) {
          return "/login?error=account-exists";
        }
      }
      return true;
    },
    /**
     * tier/subStatus on the token are FOR DISPLAY ONLY. Nothing authorizes
     * from them.
     *
     * They are a snapshot taken at sign-in, and a token lives 30 days. When a
     * customer paid, the webhook made their row ACTIVE and this snapshot went
     * on saying FREE/PENDING, so the product stayed locked until they signed
     * out and back in. Paid access is now resolved per request from the
     * database in src/lib/entitlement.ts, and every gate reads it from there.
     *
     * The claims are kept because components show them (the account banner),
     * and they are recomputed on an explicit `update()` — which is how the
     * page a payer lands on refreshes them without the client being trusted to
     * assert anything: it can ask for a refresh, the server decides what the
     * values are.
     */
    async jwt({ token, user, trigger }) {
      if (user) {
        token.uid = (user as any).id;
        token.role = (user as any).role;
      }
      // At sign-in, and again whenever the session is explicitly updated.
      // Credentials' authorize() and the OAuth adapter's user object have
      // different shapes, so both providers resolve tier/subStatus from the
      // same source here, with a FREE/PENDING fallback for a user with no
      // Subscription row yet (e.g. every new Google sign-up, which the adapter
      // never creates one for).
      if (user || trigger === "update") {
        const userId = (user as any)?.id ?? token.uid;
        if (userId) {
          const sub = await prisma.subscription.findUnique({ where: { userId: userId as string } });
          token.tier = (sub?.tier ?? "FREE") as SubscriptionTier;
          token.subStatus = (sub?.status ?? "PENDING") as SubscriptionStatus;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.uid;
        (session.user as any).role = token.role;
        (session.user as any).tier = token.tier;
        (session.user as any).subStatus = token.subStatus;
      }
      return session;
    },
  },
};

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
  tier: SubscriptionTier;
  subStatus: SubscriptionStatus;
};