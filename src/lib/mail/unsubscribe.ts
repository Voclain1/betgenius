import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Unsubscribe links.
 *
 * A link has to work for someone who is not signed in — it is opened from an
 * inbox, often on another device — so it carries its own proof: the user id
 * and the preference it turns off, signed with the server secret. Nothing is
 * stored per link, and a link never expires: an unsubscribe that stops working
 * after a month is a complaint waiting to happen.
 *
 * The signature is what stops one person unsubscribing another by editing the
 * id in the URL. It grants nothing else — the only thing a valid token can do
 * is switch one email preference off.
 */
export const UNSUBSCRIBE_KINDS = ["dailyPicks", "announcements"] as const;
export type UnsubscribeKind = (typeof UNSUBSCRIBE_KINDS)[number];

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET is required to sign unsubscribe links");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`unsubscribe:${payload}`).digest("base64url").slice(0, 32);
}

export function unsubscribeToken(userId: string, kind: UnsubscribeKind): string {
  const payload = Buffer.from(`${userId}:${kind}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(token: string | null | undefined): { userId: string; kind: UnsubscribeKind } | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const [userId, kind] = Buffer.from(payload, "base64url").toString().split(":");
  if (!userId || !(UNSUBSCRIBE_KINDS as readonly string[]).includes(kind)) return null;
  return { userId, kind: kind as UnsubscribeKind };
}

/** What the person is unsubscribing from, in their words. */
export const UNSUBSCRIBE_LABEL: Record<UnsubscribeKind, string> = {
  dailyPicks: "daily picks emails",
  announcements: "announcements from BetGenius",
};
