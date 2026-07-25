import type { ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { DashboardShell, type DashboardNavItem } from "@/components/DashboardShell";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { CATEGORY_NAMES, getCategoryPredictions } from "@/lib/categoryPredictions";
import { getTrackRecordData, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { PREDICTION_CATEGORIES, type PredictionCategory } from "@/lib/enums";

export const metadata: Metadata = {
  title: "My Account",
  robots: { index: false, follow: false },
};

function categoryKey(cat: PredictionCategory) {
  return cat.toLowerCase();
}

function AccountSection({
  email,
  sub,
}: {
  email: string;
  sub: { tier: string; status: string; currentPeriodEnd: Date | null } | null;
}) {
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">My account</h1>
      <div className="card space-y-1">
        <div className="text-sm text-gray-400">Email</div>
        <div>{email}</div>
      </div>
      <div className="card space-y-2">
        <div className="text-sm text-gray-400">Subscription</div>
        <div className="text-lg font-semibold">
          {sub?.tier ?? "FREE"} · {sub?.status ?? "ACTIVE"}
        </div>
        {sub?.currentPeriodEnd && (
          <div className="text-sm text-gray-400">Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</div>
        )}
        <div className="flex gap-2 pt-2">
          <Link href="/pricing" className="btn btn-primary">Upgrade</Link>
          <Link href="/" className="btn btn-ghost">Back to site</Link>
        </div>
      </div>
    </div>
  );
}

// Defense in depth: even if a locked category's section key is reached
// directly (a manipulated `?section=` value), this renders instead of the
// real predictions — the row data for that category is never even fetched
// (see the branch below), so there's nothing gated to leak client-side.
function LockedCategorySection({ category }: { category: PredictionCategory }) {
  const name = CATEGORY_NAMES[category];
  const needed = category === "PREMIUM" ? "Premium" : "VIP or Premium";
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{name}</h1>
      <div className="card flex flex-col items-center gap-3 py-10 text-center">
        <Lock size={28} className="text-gray-500" />
        <p className="text-lg font-semibold">This category is locked</p>
        <p className="max-w-sm text-sm text-gray-400">
          Subscribe to {needed} to unlock {name.toLowerCase()} and full reasoning.
        </p>
        <Link href="/pricing" className="btn btn-primary">Upgrade</Link>
      </div>
    </div>
  );
}

// Embeds a short summary rather than only linking out — renders in one
// request alongside the rest of the dashboard shell, reusing the same
// getTrackRecordData() the public /track-record page is built on. Full
// breakdowns (by window/category/market, recent tips) stay on that page.
async function TrackRecordSection() {
  const data = await getTrackRecordData();
  const enough = data.totalSettledAllTime >= MIN_SETTLED_SAMPLE_SIZE;
  const rate30 = data.windows[30].headline.rate;
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Track record</h1>
      <div className="card space-y-2">
        {enough ? (
          <>
            <div className="text-lg font-semibold">
              {rate30 != null ? `${Math.round(rate30 * 100)}% win rate` : "—"}{" "}
              <span className="text-sm font-normal text-gray-400">last 30 days</span>
            </div>
            <div className="text-sm text-gray-400">{data.totalSettledAllTime} settled tips all-time</div>
          </>
        ) : (
          <p className="text-sm text-gray-400">
            Not enough settled tips yet for a fair sample — {data.totalSettledAllTime} of {MIN_SETTLED_SAMPLE_SIZE}.
          </p>
        )}
        <Link href="/track-record" className="btn btn-ghost mt-2 inline-flex">View full track record</Link>
      </div>
    </div>
  );
}

export default async function AccountDashboard({
  searchParams,
}: {
  searchParams: { section?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });

  // Gating uses the session's tier/status/role — the same source
  // canViewCategory() is already fed from on /predictions/[category] — not a
  // fresh DB read, so the dashboard's access decisions stay consistent with
  // every other row-level gate in the app instead of a second source of truth.
  const canViewMap = Object.fromEntries(
    PREDICTION_CATEGORIES.map((cat) => [
      cat,
      canViewCategory(cat, session.user.tier, session.user.subStatus, session.user.role),
    ]),
  ) as Record<PredictionCategory, boolean>;

  const navItems: DashboardNavItem[] = [
    ...PREDICTION_CATEGORIES.map((cat) => ({
      key: categoryKey(cat),
      href: `/dashboard?section=${categoryKey(cat)}`,
      label: CATEGORY_NAMES[cat],
      locked: !canViewMap[cat],
    })),
    { key: "track-record", href: "/dashboard?section=track-record", label: "Track Record" },
    { key: "account", href: "/dashboard?section=account", label: "Account" },
  ];

  const validKeys = new Set(navItems.map((i) => i.key));
  const requested = searchParams.section?.toLowerCase();
  const activeKey = requested && validKeys.has(requested) ? requested : "account";

  let content: ReactNode;
  const activeCategory = PREDICTION_CATEGORIES.find((cat) => categoryKey(cat) === activeKey);

  if (activeCategory) {
    const canView = canViewMap[activeCategory];
    if (!canView) {
      content = <LockedCategorySection category={activeCategory} />;
    } else {
      const rows = await getCategoryPredictions(activeCategory);
      const shaped = rows.map((r) => ({ ...r, category: activeCategory }));
      content = (
        <div className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold">{CATEGORY_NAMES[activeCategory]}</h1>
              <p className="text-sm text-gray-400">{shaped.length} live picks</p>
            </div>
            <Link href={`/predictions/${activeKey}`} className="btn btn-ghost text-sm">
              View full page
            </Link>
          </div>
          <CategoryPredictionsList category={activeCategory} rows={shaped as any} />
        </div>
      );
    }
  } else if (activeKey === "track-record") {
    content = <TrackRecordSection />;
  } else {
    content = <AccountSection email={session.user.email} sub={sub} />;
  }

  return (
    <DashboardShell items={navItems} activeKey={activeKey} userEmail={session.user.email}>
      {content}
    </DashboardShell>
  );
}
