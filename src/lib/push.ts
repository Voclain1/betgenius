import webpush from "web-push";
import { prisma } from "@/lib/prisma";

let configured = false;

export function pushConfigured() {
  return !!(process.env.VAPID_SUBJECT && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configure() {
  if (configured) return;
  const { VAPID_SUBJECT: subject, NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env;
  if (!subject || !publicKey || !privateKey) throw new Error("VAPID credentials are not configured");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

/**
 * Sends one push. Returns false when the endpoint is gone (404/410) and the
 * subscription has been removed; throws on any other failure so the caller can
 * schedule a retry. `transport` is injectable for tests.
 */
export async function sendPush(
  subscription: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: unknown,
  transport = webpush.sendNotification,
) {
  if (transport === webpush.sendNotification) configure();
  try {
    await transport({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { TTL: 300 });
    await prisma.pushSubscription.updateMany({ where: { id: subscription.id }, data: { lastSuccessAt: new Date(), failureCount: 0 } });
    return true;
  } catch (error: any) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
      return false;
    }
    await prisma.pushSubscription.updateMany({ where: { id: subscription.id }, data: { failureCount: { increment: 1 } } });
    throw error;
  }
}
