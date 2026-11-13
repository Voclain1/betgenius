import type { ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Bookmark, CalendarDays, Lock, Star } from "lucide-react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasActivePaidAccess, type Entitlement } from "@/lib/entitlement";
import { DashboardShell } from "@/components/DashboardShell";
import { dashboardNavItems, loadDashboardContext } from "@/lib/dashboardContext";
import { getPersonalization, interestsOf, personalizePicks, savedHighlights, todaysPicks, upcomingForFavourites, type PersonalizationState } from "@/lib/personalizationData";
import { hasInterests, longDateInZone, marketPreferenceLabel, shouldInviteToPersonalize, shouldStartOnboarding, zoneAbbreviation } from "@/lib/personalization";
import { EmptyState, PickList, PickRow, SavedRow, SectionHeader, UpcomingList } from "@/components/personal/DashboardParts";
import { DashboardViewTracker, PersonalizeInvite, RemoveSavedButton } from "@/components/personal/ClientBits";
import { leagueSlug, teamSlug } from "@/lib/slug";
import { competitionPredictionsHref } from "@/lib/cupConfig";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { SubscriptionBanner } from "@/components/SubscriptionBanner";
import { SignupUpsellModal } from "@/components/SignupUpsellModal";
import { PaymentConfirmation } from "@/components/PaymentConfirmation";
import { tierFromFlutterwaveReference } from "@/lib/payments/flutterwave";
import { tierFromKorapayReference } from "@/lib/payments/korapay";
import { SignupConfirmation } from "@/components/SignupConfirmation";
import { catStyles } from "@/components/PredictionCard";
import { textTone } from "@/lib/tone";
import { CATEGORY_NAMES, CATEGORY_CHIP_LABELS, getCategoryPredictions } from "@/lib/categoryPredictions";
import { getMonthTrackRecord, MIN_SETTLED_SAMPLE_SIZE } from "@/lib/trackRecord";
import { PREDICTION_CATEGORIES, type PredictionCategory, type SubscriptionStatus, type SubscriptionTier } from "@/lib/enums";
export const dynamic = "force-dynamic";
import { tierFromCheckoutReference } from "@/lib/paystack/checkoutReference";
import { PLAN_PRICING, type PaidTier } from "@/lib/pricing";

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
const TILE_LABELS = CATEGORY_CHIP_LABELS;

function AccountSection({
  email,
  name,
  memberSince,
  tier,
  status,
  currentPeriodEnd,
  personal,
  savedCount,
}: {
  email: string;
  name: string | null;
  memberSince: Date | null;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  personal: PersonalizationState;
  savedCount: number;
}) {
  const rows: Array<{ label: string; value: ReactNode; href?: string; action?: string }> = [
    { label: "Favourite teams", value: personal.teams.length ? personal.teams.map((t) => t.name).join(", ") : "None yet", href: "/dashboard/preferences#teams", action: "Edit" },
    { label: "Favourite competitions", value: personal.leagues.length ? personal.leagues.map((l) => l.name).join(", ") : "None yet", href: "/dashboard/preferences#competitions", action: "Edit" },
    { label: "Preferred markets", value: personal.preferredMarkets.length ? personal.preferredMarkets.map(marketPreferenceLabel).join(", ") : "Any market", href: "/dashboard/preferences#markets", action: "Edit" },
    { label: "Timezone", value: `${personal.timezone} (${zoneAbbreviation(personal.timezone)})`, href: "/dashboard/preferences#timezone", action: "Change" },
    { label: "Saved predictions", value: `${savedCount}`, href: "/dashboard/saved", action: "View" },
    { label: "Notifications", value: "Push alerts, kickoff reminders and quiet hours", href: "/notifications", action: "Manage" },
    { label: "Email", value: "Newsletters and account email", href: "/email", action: "Manage" },
  ];
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My account</h1>
        <p className="text-sm text-gray-400">
          {name ? `${name} · ` : ""}
          {email}
          {memberSince ? ` · Member since ${memberSince.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: personal.timezone })}` : ""}
        </p>
      </div>
      <SubscriptionBanner tier={tier} status={status} currentPeriodEnd={currentPeriodEnd} />
      <dl className="divide-y divide-brand-border overflow-hidden rounded-xl border border-brand-border bg-brand-card">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[12rem_1fr_auto]">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-500">{r.label}</dt>
            <dd className="col-start-1 min-w-0 text-sm text-gray-100 sm:col-start-auto">{r.value}</dd>
            {r.href && (
              <Link href={r.href} className="col-start-2 row-span-2 row-start-1 text-sm font-semibold text-brand hover:underline sm:col-start-auto sm:row-span-1 sm:row-start-auto">
                {r.action}
              </Link>
            )}
          </div>
        ))}
      </dl>
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

// Embeds a short summary rather than only linking out, from the same
// calendar-month record the public /track-record page shows. Full breakdowns
// (by category and market, recent results) stay on that page.
async function TrackRecordSection() {
  const data = await getMonthTrackRecord();
  const rate = data.headline.decided >= MIN_SETTLED_SAMPLE_SIZE ? data.headline.rate : null;
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Track record</h1>
      <div className="card space-y-2">
        {rate != null ? (
          <div className="text-lg font-semibold">
            {Math.round(rate * 100)}% win rate <span className="text-sm font-normal text-gray-400">{data.monthLabel}</span>
          </div>
        ) : (
          <p className="text-sm text-gray-400">{data.monthLabel}&apos;s record is still building as matches settle.</p>
        )}
        {data.previousMonth && (
          <div className="text-sm text-gray-400">{data.previousMonth.label} closed at {Math.round(data.previousMonth.rate * 100)}%</div>
        )}
        <Link href="/track-record" className="btn btn-ghost mt-2 inline-flex">View full track record</Link>
      </div>
    </div>
  );
}

function greeting(now: Date, timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

// The personalised overview. Every section reads real published data and
// says plainly when there is nothing to show; nothing is invented to fill it.
// Below it, the existing subscription banner and category tiles carry on.
async function OverviewSection({
  userId,
  name,
  viewer,
  personal,
  tier,
  status,
  currentPeriodEnd,
  unlockedCategories,
  paymentNotice,
}: {
  userId: string;
  name: string | null;
  viewer: Entitlement;
  personal: PersonalizationState;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  unlockedCategories: PredictionCategory[];
  paymentNotice?: ReactNode;
}) {
  const now = new Date();
  const tz = personal.timezone;
  const interests = interestsOf(personal);
  const personalised = hasInterests(interests);
  const favouriteCount = personal.teams.length + personal.leagues.length;

  const [picks, upcoming, saved, categoryCounts] = await Promise.all([
    todaysPicks(viewer, tz, now),
    upcomingForFavourites(personal, now),
    savedHighlights(userId, viewer, now),
    Promise.all(unlockedCategories.map(async (cat) => [cat, (await getCategoryPredictions(cat)).length] as const)),
  ]);
  const { relevant, others } = personalizePicks(picks, interests, now);
  const invite = shouldInviteToPersonalize({
    hasPreferenceRow: personal.hasPreferenceRow,
    favouriteCount,
    marketCount: personal.preferredMarkets.length,
    skipped: !!personal.onboardingSkippedAt,
    completed: !!personal.onboardingCompletedAt,
  });
  const firstName = name?.trim().split(/\s+/)[0];

  return (
    <div className="space-y-8">
      <DashboardViewTracker personalized={personalised} />
      {paymentNotice}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
            {longDateInZone(now, tz)} · {zoneAbbreviation(tz, now)}
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-[1.75rem]">
            {greeting(now, tz)}{firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <Link href="/dashboard/preferences" className="btn btn-ghost px-3 py-1.5 text-sm">Edit preferences</Link>
      </header>

      {invite && <PersonalizeInvite />}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="space-y-3" aria-labelledby="for-you">
          <span id="for-you" className="sr-only">Today&apos;s predictions for you</span>
          {personalised ? (
            <>
              <SectionHeader title="For you today" count={relevant.length} action={{ href: "/predictions/today", label: "All of today" }} />
              {relevant.length > 0 ? (
                <PickList>{relevant.slice(0, 8).map((r) => <PickRow key={r.row.id} row={r.row} reasons={r.reasons} timezone={tz} />)}</PickList>
              ) : (
                <EmptyState
                  title={picks.length ? "Nothing from your teams or markets today" : "No predictions published for today yet"}
                  body={picks.length
                    ? "None of today's published predictions involve your teams, competitions or preferred markets. The rest of today's slate is below."
                    : "Predictions are published through the day as the analysis for each fixture completes. Check back later."}
                  action={{ href: "/dashboard/preferences", label: "Review your preferences" }}
                />
              )}
              {others.length > 0 && (
                <div className="space-y-3 pt-2">
                  <SectionHeader title="Also today" />
                  <PickList>{others.slice(0, relevant.length ? 4 : 8).map((r) => <PickRow key={r.row.id} row={r.row} reasons={[]} timezone={tz} />)}</PickList>
                </div>
              )}
            </>
          ) : (
            <>
              <SectionHeader title="Today's top predictions" count={others.length} action={{ href: "/predictions/today", label: "All of today" }} />
              {others.length > 0 ? (
                <PickList>{others.slice(0, 8).map((r) => <PickRow key={r.row.id} row={r.row} reasons={[]} timezone={tz} />)}</PickList>
              ) : (
                <EmptyState title="No predictions published for today yet" body="Predictions are published through the day as the analysis for each fixture completes." action={{ href: "/predictions", label: "Browse predictions" }} />
              )}
            </>
          )}
        </section>

        <div className="space-y-8">
          <section className="space-y-3">
            <SectionHeader title="Upcoming for you" action={favouriteCount ? { href: "/dashboard/preferences#teams", label: "Manage" } : undefined} />
            {upcoming.length > 0 ? (
              <UpcomingList fixtures={upcoming.slice(0, 6)} timezone={tz} />
            ) : favouriteCount ? (
              <EmptyState icon={<CalendarDays size={18} />} title="No upcoming fixtures found" body="We have no scheduled matches for your teams or competitions in the next three weeks. Fixture lists refresh daily." />
            ) : (
              <EmptyState icon={<Star size={18} />} title="Follow your teams" body="Choose the clubs and competitions you care about and their next matches appear here." action={{ href: "/dashboard/preferences#teams", label: "Choose teams" }} />
            )}
          </section>

          <section className="space-y-3">
            <SectionHeader title="Saved" count={saved.total || undefined} action={saved.total ? { href: "/dashboard/saved", label: "View all" } : undefined} />
            {saved.total === 0 ? (
              <EmptyState icon={<Bookmark size={18} />} title="No saved predictions" body="Tap the bookmark on any prediction to keep it here and follow its result." action={{ href: "/predictions/today", label: "Browse today's predictions" }} />
            ) : (
              <div className="space-y-4">
                {saved.upcoming.length > 0 && (
                  <PickList>{saved.upcoming.map((i) => <SavedRow key={i.id} item={i} timezone={tz} actions={<RemoveSavedButton predictionId={i.predictionId} savedId={i.id} />} />)}</PickList>
                )}
                {saved.settled.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-gray-500">Recently settled</div>
                    <PickList>{saved.settled.map((i) => <SavedRow key={i.id} item={i} timezone={tz} />)}</PickList>
                  </div>
                )}
                {saved.upcoming.length === 0 && saved.settled.length === 0 && (
                  <p className="text-sm text-gray-400">Your saved predictions are waiting on results. <Link href="/dashboard/saved" className="font-semibold text-brand hover:underline">Open saved</Link></p>
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionHeader title="Your favourites" action={{ href: "/dashboard/preferences", label: favouriteCount ? "Edit" : "Add" }} />
            {favouriteCount ? (
              <div className="flex flex-wrap gap-2">
                {personal.teams.map((t) => (
                  <Link key={`t${t.id}`} href={`/predictions/team/${teamSlug(t.name)}`} className="inline-flex min-h-9 items-center rounded-lg border border-brand-border px-3 text-sm text-gray-100 hover:border-gray-500">{t.name}</Link>
                ))}
                {personal.leagues.map((l) => (
                  <Link key={`l${l.id}`} href={competitionPredictionsHref(l.id, leagueSlug(l.name, l.id))} className="inline-flex min-h-9 items-center rounded-lg border border-brand-border px-3 text-sm text-gray-400 hover:border-gray-500">{l.name}</Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No favourites yet. Teams and competitions you follow appear here.</p>
            )}
          </section>
        </div>
      </div>

      <SubscriptionBanner tier={tier} status={status} currentPeriodEnd={currentPeriodEnd} />

      <div className="space-y-3">
        <SectionHeader title="Your categories" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {categoryCounts.map(([cat, count]) => (
            <Link
              key={cat}
              href={`/dashboard?section=${categoryKey(cat)}`}
              className="group flex flex-col gap-2 rounded-xl border border-brand-border bg-brand-card p-3 transition hover:bg-brand-bg/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.1em] ${textTone(catStyles[cat] ?? "text-gray-400")}`}>{TILE_LABELS[cat]}</span>
                <ArrowRight size={14} className="shrink-0 text-gray-500 transition group-hover:translate-x-0.5 group-hover:text-brand" />
              </div>
              <div className="text-xl font-bold tabular-nums">{count} <span className="text-xs font-normal text-gray-400">live</span></div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function AccountDashboard({
  searchParams,
}: {
  searchParams: { section?: string; paid?: string; reference?: string; trxref?: string; provider?: string; tx_ref?: string; transaction_id?: string };
}) {
  const { session, userId, sub, account, viewer, canViewMap } = await loadDashboardContext("/dashboard");
  const unlockedCategories = PREDICTION_CATEGORIES.filter((cat) => canViewMap[cat]);
  const personal = await getPersonalization(userId);

  // A brand-new account lands in the setup flow once. Only the bare
  // /dashboard: a payment callback (?paid=1, references) or any ?section= is
  // a destination the reader asked for and is never intercepted. Existing
  // accounts are never redirected — they get the invitation card instead.
  const bare = !searchParams.section && !searchParams.paid && !searchParams.reference && !searchParams.trxref && !searchParams.tx_ref;
  if (
    bare &&
    account &&
    shouldStartOnboarding({ createdAt: account.createdAt, hasPreferenceRow: personal.hasPreferenceRow, favouriteCount: personal.teams.length + personal.leagues.length })
  ) {
    redirect("/dashboard/welcome");
  }

  // Paystack appends reference/trxref to the callback; Flutterwave appends
  // tx_ref and transaction_id (lib/payments/flutterwave); Korapay returns to
  // the reference we put in its redirect_url (lib/payments/korapay).
  const paymentReference = searchParams.reference ?? searchParams.trxref ?? searchParams.tx_ref ?? null;
  const paymentTier = tierFromCheckoutReference(paymentReference) ?? tierFromFlutterwaveReference(paymentReference) ?? tierFromKorapayReference(paymentReference) ??
    (sub?.tier === "VIP" || sub?.tier === "PREMIUM" ? sub.tier as PaidTier : null);
  // Whether THIS payment landed — not whether the viewer has access. The two
  // used to be the same test, so a subscriber who already had access and
  // abandoned a renewal or upgrade came back to "Payment received", and the
  // purchase event fired for money that never moved. With a reference, the
  // answer is whether that reference bought a period for this user.
  const paymentApplied =
    searchParams.paid !== "1"
      ? false
      : paymentReference
        ? sub?.lastPaymentRef === paymentReference ||
          !!(await prisma.paymentAttempt.findFirst({
            where: { reference: paymentReference, userId: userId, entitlementGrantedAt: { not: null } },
            select: { id: true },
          }))
        : hasActivePaidAccess(sub);

  const navItems = dashboardNavItems(canViewMap);

  // Only the sections this page renders; saved/preferences/notifications are their own routes.
  const validKeys = new Set(["overview", "track-record", "account", ...PREDICTION_CATEGORIES.map(categoryKey)]);
  const requested = searchParams.section?.toLowerCase();
  const activeKey = requested && validKeys.has(requested) ? requested : "overview";

  let content: ReactNode;
  let title: string;
  const activeCategory = PREDICTION_CATEGORIES.find((cat) => categoryKey(cat) === activeKey);

  if (activeKey === "overview") {
    title = "My dashboard";
    content = (
      <OverviewSection
        userId={userId}
        name={account?.name ?? session.user.name ?? null}
        viewer={viewer}
        personal={personal}
        tier={viewer.tier ?? "FREE"}
        status={viewer.status ?? "PENDING"}
        currentPeriodEnd={sub?.currentPeriodEnd ?? null}
        unlockedCategories={unlockedCategories}
        paymentNotice={
          // `paid=1` only decides whether to SHOW this; whether the payment
          // landed is `activated`, computed from the database row above. The
          // reference is what Paystack appends to the callback URL, and it is
          // passed through only so the component can ASK the server to verify
          // it — a reference in the URL grants nothing by itself.
          searchParams.paid === "1" ? (
            <PaymentConfirmation
              activated={paymentApplied}
              reference={paymentReference}
              provider={searchParams.provider ?? null}
              transactionId={searchParams.transaction_id ?? null}
              tier={paymentTier}
              value={paymentTier ? PLAN_PRICING[paymentTier].ngn : null}
            />
          ) : null
        }
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
        name={account?.name ?? null}
        memberSince={account?.createdAt ?? null}
        personal={personal}
        savedCount={await prisma.savedPrediction.count({ where: { userId } })}
        tier={viewer.tier ?? "FREE"}
        status={viewer.status ?? "PENDING"}
        currentPeriodEnd={sub?.currentPeriodEnd ?? null}
      />
    );
  }

  return (
    <DashboardShell items={navItems} activeKey={activeKey} title={title} userEmail={session.user.email}>
      <SignupConfirmation method={(session as any).pendingSignUpMethod ?? null} />
      {content}
      {/* The post-signup plan offer. Mounted HERE because /dashboard is where
          both signup paths already land — credentials registration pushes to
          it, and Google OAuth returns to it — so nothing needed redirecting to
          make this appear at the right moment.

          Every input is server-derived. `paid` comes from the same resolved
          entitlement the rest of this page gates on, not from a session claim,
          so a customer who paid seconds after registering is never sold a plan
          they already hold. The component decides only whether it was already
          dismissed. */}
      {account && (
        <SignupUpsellModal
          userId={userId}
          createdAt={account.createdAt.toISOString()}
          tier={viewer.tier ?? "FREE"}
          paid={hasActivePaidAccess(sub)}
        />
      )}
    </DashboardShell>
  );
}
