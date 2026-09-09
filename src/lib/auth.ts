import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role, SubscriptionStatus, SubscriptionTier } from "@/lib/enums";

/**
 * Secure cookies follow the deployment URL, exactly as NextAuth's own default
 * does — https means production means secure cookies.
 */
const useSecureCookies = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

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
 */
const sessionCookieName = useSecureCookies
  ? "__Host-next-auth.session-token"
  : "next-auth.session-token";

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
      name: sessionCookieName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        // Both required by the `__Host-` prefix, and both what NextAuth would
        // have used anyway.
        path: "/",
        secure: useSecureCookies,
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
      if (account?.provider === "google" && user.email) {
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
    async jwt({ token, user }) {
      // Only recomputed at sign-in (`user` is only passed on that first
      // call) — same as before, so tier/subStatus are cached in the JWT for
      // its lifetime rather than hitting the DB on every session check.
      if (user) {
        token.uid = (user as any).id;
        token.role = (user as any).role;
        // Not read off `user` — Credentials' authorize() and the OAuth
        // adapter's user object have different shapes (only authorize() used
        // to precompute these before), so both providers now resolve
        // tier/subStatus here instead, from the same source, with the same
        // FREE/PENDING fallback for a user with no Subscription row yet
        // (e.g. every new Google sign-up, which the adapter never creates
        // one for).
        const sub = await prisma.subscription.findUnique({ where: { userId: (user as any).id } });
        token.tier = (sub?.tier ?? "FREE") as SubscriptionTier;
        token.subStatus = (sub?.status ?? "PENDING") as SubscriptionStatus;
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