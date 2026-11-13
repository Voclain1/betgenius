import type { Metadata } from "next";
import Link from "next/link";
import { loadDashboardContext } from "@/lib/dashboardContext";
import { getPersonalization, popularTeams } from "@/lib/personalizationData";
import { orderedCompetitions } from "@/lib/personalization";
import { OnboardingFlow } from "@/components/personal/PreferencesForms";
import { SignupConfirmation } from "@/components/SignupConfirmation";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = { title: "Set up your dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * First-time setup. New accounts are sent here once from /dashboard; anyone
 * can open it again from Preferences. Deliberately outside the sidebar shell:
 * a focused flow with one way forward and an obvious way out.
 */
export default async function WelcomePage() {
  const { session, userId } = await loadDashboardContext("/dashboard/welcome");
  const [personal, popular] = await Promise.all([getPersonalization(userId), popularTeams().catch(() => [])]);
  return (
    <div className="min-h-screen bg-brand-bg">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-lg font-bold">
          <span className="text-brand">Bet</span>Genius
        </Link>
        <ThemeToggle />
      </header>
      <main className="px-4 pb-6">
        {/* A Google sign-up lands here first now; record it here too. It fires once — the session marker is cleared on use. */}
        <SignupConfirmation method={(session as { pendingSignUpMethod?: "google" | null }).pendingSignUpMethod ?? null} />
        <OnboardingFlow
          initial={{ teams: personal.teams, leagues: personal.leagues, markets: personal.preferredMarkets, timezone: personal.timezone }}
          competitions={orderedCompetitions()}
          popularTeams={popular}
        />
      </main>
    </div>
  );
}
