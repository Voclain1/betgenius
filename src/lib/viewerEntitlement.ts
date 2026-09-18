import { cache } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ANONYMOUS, entitlementFor, type Entitlement } from "@/lib/entitlement";
import type { Role } from "@/lib/enums";

/**
 * The signed-in viewer's entitlement, from the database, once per request.
 *
 * Separate from entitlement.ts so the rules there stay pure and assertable:
 * this half needs the request (the session) and the database, that half needs
 * neither. `cache()` dedupes within a single render — a page that gates thirty
 * rows reads the subscription once, not thirty times. Anonymous visitors cost
 * no query at all.
 */
export const getViewerEntitlement = cache(async (): Promise<Entitlement & { userId?: string }> => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return ANONYMOUS;
  const sub = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    select: { tier: true, status: true, currentPeriodEnd: true },
  });
  return { ...entitlementFor(sub, session.user.role as Role), userId: session.user.id };
});
