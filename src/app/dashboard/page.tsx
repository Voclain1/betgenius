import type { ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Lock } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { DashboardShell, type DashboardNavItem } from "@/components/DashboardShell";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { SubscriptionBanner } from "@/components/SubscriptionBanner";
import { catStyles } from "@/components/PredictionCard";
import { CATEGORY_NAMES, getCategoryPredictions } from "@/lib/categoryPredictions";
import { getTrackRecordData, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { PREDICTION_CATEGORIES, type PredictionCategory, type SubscriptionStatus, type SubscriptionTier } from "@/lib/enums";

export const metadata: Metadata = {
  title: "My Account",
  robots: { index: false, follow: false },
};

function categoryKey(cat: PredictionCategory) {
  return cat.toLowerCase();
}

// Short form for the compact tile chips specifically — CATEGORY_NAMES's full
// names ("Today's predictions") wrap inside a two-column mobile tile. Same
// shorthand the main Nav already uses for its links.
const TILE_LABELS: Record<PredictionCategory, string> = {
  FEATURED: "Featured",
  GENIUS: "Genius",
  TODAY: "Today",
  BANKER: "Banker",
  VIP: "VIP",
  PREMIUM: "Premium",
};

function AccountSection({
  email,
  tier,
  status,
  currentPeriodEnd,
}: {
  email: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
}) {
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">My account</h1>
      <SubscriptionBanner tier={tier} status={status} currentPeriodEnd={currentPeriodEnd} />
      <div className="card space-y-1">
        <div className="text-sm text-gray-400">Email</div>
        <div>{email}</div>
      </div>
      <Link href="/" className="btn btn-ghost inline-flex">Back to site</Link>
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

// Default landing view: the subscription banner (the one signature moment),
// quick-access tiles to whatever's unlocked, and a compact recent-picks
// preview — something actionable, not a settings form.
async function OverviewSection({
  tier,
  status,
  currentPeriodEnd,
  unlockedCategories,
}: {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  unlockedCategories: PredictionCategory[];
}) {
  const categoryRows = Object.fromEntries(
    await Promise.all(
      unlockedCategories.map(async (cat) => [cat, await getCategoryPredictions(cat)] as const),
    ),
  ) as Record<PredictionCategory, Awaited<ReturnType<typeof getCategoryPredictions>>>;

  const previewCategory =
    unlockedCategories.find((c) => c === "TODAY" && categoryRows[c].length > 0) ??
    unlockedCategories.find((c) => categoryRows[c].length > 0) ??
    unlockedCategories[0];

  const previewRows = previewCategory
    ? categoryRows[previewCategory].slice(0, 3).map((r) => ({ ...r, category: previewCategory }))
    : [];

  return (
    <div className="space-y-8">
      <SubscriptionBanner tier={tier} status={status} currentPeriodEnd={currentPeriodEnd} />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Your categories</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {unlockedCategories.map((cat) => (
            <Link
              key={cat}
              href={`/dashboard?section=${categoryKey(cat)}`}
              className="group flex flex-col gap-3 rounded-2xl border border-brand-border bg-brand-card p-4 transition hover:border-brand/50 hover:bg-brand-bg/60 sm:p-5"
            >
              <div className="flex items-center justify-between">
                <span className={`chip whitespace-nowrap ${catStyles[cat] ?? "bg-gray-500/20"}`}>{TILE_LABELS[cat]}</span>
                <ArrowRight size={16} className="shrink-0 text-gray-500 transition group-hover:translate-x-0.5 group-hover:text-brand" />
              </div>
              <div>
                <div className="text-2xl font-bold">{categoryRows[cat].length}</div>
                <div className="text-xs text-gray-400">live picks</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {previewCategory && previewRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Recent picks</h2>
            <Link href={`/dashboard?section=${categoryKey(previewCategory)}`} className="text-sm text-gray-400 hover:text-brand">
              View all →
            </Link>
          </div>
          <CategoryPredictionsList category={previewCategory} rows={previewRows as any} />
        </div>
      )}
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
  const unlockedCategories = PREDICTION_CATEGORIES.filter((cat) => canViewMap[cat]);

  const navItems: DashboardNavItem[] = [
    { key: "overview", href: "/dashboard?section=overview", label: "Overview" },
    ...PREDICTION_CATEGORIES.map((cat) => ({
      key: categoryKey(cat),
      href: `/dashboard?section=${categoryKey(cat)}`,
      label: CATEGORY_NAMES[cat],
      locked: !canViewMap[cat],
    })),
    { key: "track-record", href: "/dashboard?section=track-record", label: "Track Record" },
    // Links out to the existing standalone page rather than duplicating it as
    // a ?section= — Bet Builder's client-side state (legs, stake, source
    // tabs) doesn't fit the server-rendered section model the other items
    // use, and there's no reason to maintain two copies of the same page.
    { key: "bet-builder", href: "/bet-builder", label: "Bet Builder" },
    { key: "account", href: "/dashboard?section=account", label: "Account" },
  ];

  const validKeys = new Set(navItems.map((i) => i.key));
  const requested = searchParams.section?.toLowerCase();
  const activeKey = requested && validKeys.has(requested) ? requested : "overview";

  let content: ReactNode;
  let title: string;
  const activeCategory = PREDICTION_CATEGORIES.find((cat) => categoryKey(cat) === activeKey);

  if (activeKey === "overview") {
    title = "Overview";
    content = (
      <OverviewSection
        tier={session.user.tier}
        status={session.user.subStatus}
        currentPeriodEnd={sub?.currentPeriodEnd ?? null}
        unlockedCategories={unlockedCategories}
      />
    );
  } else if (activeCategory) {
    title = CATEGORY_NAMES[activeCategory];
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
    title = "Track Record";
    content = <TrackRecordSection />;
  } else {
    title = "Account";
    content = (
      <AccountSection
        email={session.user.email}
        tier={session.user.tier}
        status={session.user.subStatus}
        currentPeriodEnd={sub?.currentPeriodEnd ?? null}
      />
    );
  }

  return (
    <DashboardShell items={navItems} activeKey={activeKey} title={title} userEmail={session.user.email}>
      {content}
    </DashboardShell>
  );
}
