import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role, SubscriptionStatus, SubscriptionTier } from "@/lib/enums";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
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