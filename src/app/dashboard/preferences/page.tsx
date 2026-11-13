import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
import { dashboardNavItems, loadDashboardContext } from "@/lib/dashboardContext";
import { getPersonalization, popularTeams } from "@/lib/personalizationData";
import { orderedCompetitions } from "@/lib/personalization";
import { PreferencesForm } from "@/components/personal/PreferencesForms";

export const metadata: Metadata = { title: "Preferences", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const { session, userId, canViewMap } = await loadDashboardContext("/dashboard/preferences");
  const [personal, popular] = await Promise.all([getPersonalization(userId), popularTeams().catch(() => [])]);

  return (
    <DashboardShell items={dashboardNavItems(canViewMap)} activeKey="preferences" title="Preferences" userEmail={session.user.email}>
      <div className="max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Preferences</h1>
            <p className="text-sm text-gray-400">Shape what your dashboard puts first. Notification settings live in <Link href="/notifications" className="text-brand hover:underline">Notifications</Link>.</p>
          </div>
          {!personal.onboardingCompletedAt && (
            <Link href="/dashboard/welcome" className="text-sm font-semibold text-brand hover:underline">Guided setup</Link>
          )}
        </div>
        <PreferencesForm
          initial={{ teams: personal.teams, leagues: personal.leagues, markets: personal.preferredMarkets, timezone: personal.timezone }}
          competitions={orderedCompetitions()}
          popularTeams={popular}
        />
      </div>
    </DashboardShell>
  );
}
