import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { entitlementFor } from "@/lib/entitlement";
import { CATEGORY_NAMES } from "@/lib/categoryPredictions";
import { PREDICTION_CATEGORIES, type PredictionCategory, type Role } from "@/lib/enums";
import type { DashboardNavItem } from "@/components/DashboardShell";

/**
 * What every /dashboard page needs: the session (or a redirect to sign in that
 * returns here), the subscription row and the entitlement resolved from it,
 * and the sidebar. One place, so the overview and the Sprint 01 pages
 * (saved, preferences, welcome) cannot gate differently.
 *
 * The middleware already requires a session for /dashboard; the redirect here
 * is the server-side check that does not depend on it.
 */
export const loadDashboardContext = cache(async (returnTo: string) => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
  const userId = session.user.id as string;
  const [sub, account] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, name: true } }),
  ]);
  const viewer = entitlementFor(sub, session.user.role as Role);
  const canViewMap = Object.fromEntries(
    PREDICTION_CATEGORIES.map((cat) => [cat, canViewCategory(cat, viewer.tier, viewer.status, viewer.role)]),
  ) as Record<PredictionCategory, boolean>;
  return { session, userId, sub, account, viewer, canViewMap };
});

export function dashboardNavItems(canViewMap: Record<PredictionCategory, boolean>): DashboardNavItem[] {
  return [
    { key: "overview", href: "/dashboard", label: "My dashboard" },
    { key: "saved", href: "/dashboard/saved", label: "Saved predictions" },
    { key: "preferences", href: "/dashboard/preferences", label: "Preferences" },
    ...PREDICTION_CATEGORIES.map((cat) => ({
      key: cat.toLowerCase(),
      href: `/dashboard?section=${cat.toLowerCase()}`,
      label: CATEGORY_NAMES[cat],
      locked: !canViewMap[cat],
      group: "Predictions",
    })),
    { key: "track-record", href: "/dashboard?section=track-record", label: "Track Record", group: "More" },
    // Links out to the existing standalone pages rather than duplicating them
    // as a ?section= — Bet Builder's client-side state doesn't fit the
    // server-rendered section model, and two copies of a page drift.
    { key: "bet-builder", href: "/bet-builder", label: "Bet Builder", group: "More" },
    { key: "multi-bets", href: "/multi-bets", label: "Multi Bets", group: "More" },
    { key: "notifications", href: "/notifications", label: "Notifications", group: "More" },
    { key: "account", href: "/dashboard?section=account", label: "Account", group: "More" },
  ];
}
