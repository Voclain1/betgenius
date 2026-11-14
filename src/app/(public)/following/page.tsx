import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory, presentedCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import type { PredictionCategory } from "@/lib/enums";
import { FollowButton, type FollowTargetType } from "@/components/FollowButton";
import { matchSlug } from "@/lib/slug";
import { getPersonalization } from "@/lib/personalizationData";
import { FollowingFeedCard } from "@/components/personal/FollowingFeedCard";
import { FollowingViewTracker } from "@/components/personal/ClientBits";

export const metadata = { title: "Following", robots: { index: false, follow: false } };

const PAGE_SIZE = 20;

export default async function FollowingPage({ searchParams }: { searchParams: { page?: string } }) {
  const session = await getServerSession(authOptions);
  const viewer = await getViewerEntitlement();
  if (!session?.user.id) redirect("/login?callbackUrl=%2Ffollowing");
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);

  const [personal, now] = [await getPersonalization(session.user.id), new Date()];
  const timezone = personal.timezone;
  const follows = await prisma.userFollow.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" } });
  const keysOf = (type: FollowTargetType) => follows.filter((f) => f.targetType === type).map((f) => f.targetKey);
  const teams = keysOf("TEAM").map(Number);
  const leagues = keysOf("LEAGUE").map(Number);
  const tips = keysOf("PREDICTION");
  const categories = keysOf("CATEGORY");

  const OR: Prisma.PredictionWhereInput[] = [];
  if (teams.length) OR.push({ homeTeamApiId: { in: teams } }, { awayTeamApiId: { in: teams } });
  if (leagues.length) OR.push({ leagueApiId: { in: leagues } });
  if (tips.length) OR.push({ id: { in: tips } });
  if (categories.length) OR.push({ categories: { some: { category: { in: categories } } } });

  const rows = OR.length
    ? await prisma.prediction.findMany({
        where: { status: "PUBLISHED", OR },
        include: { categories: true },
        orderBy: [{ kickoff: "desc" }, { publishedAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Following</h1>
        <p className="text-gray-400">One feed across every team, league, tip and category you follow.</p>
        <nav aria-label="Your account" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link className="font-semibold text-brand hover:underline" href="/dashboard">Dashboard</Link>
          <Link className="font-semibold text-brand hover:underline" href="/dashboard/saved">Saved predictions</Link>
          <Link className="font-semibold text-brand hover:underline" href="/dashboard/preferences">Preferences</Link>
        </nav>
      </div>
      <FollowingViewTracker follows={follows.length} />

      {!follows.length ? (
        <div className="card">
          <p>Follow teams, leagues, tips or categories from prediction pages and Match Insights.</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link className="inline-block text-brand" href="/dashboard/preferences#teams">Choose teams and competitions →</Link>
            <Link className="inline-block text-brand" href="/match-insights">Explore Match Insights →</Link>
          </div>
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="section-heading">Manage follows</h2>
          <div className="flex flex-wrap gap-2">
            {follows.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-full border border-brand-border px-3 py-1">
                <span className="text-sm">{f.label || `${f.targetType.toLowerCase()} ${f.targetKey}`}</span>
                <FollowButton compact initiallyFollowing targetType={f.targetType as FollowTargetType} targetKey={f.targetKey} label={f.label ?? undefined} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="section-heading">Your prediction feed</h2>
        {rows.slice(0, PAGE_SIZE).map((p) => {
          const allowed = canViewCategory(presentedCategory(p.category, p.categories), viewer.tier, viewer.status, viewer.role);
          const slug = matchSlug(p);
          const rowCategories = p.categories.map((c) => c.category);
          const reasons: string[] = [];
          if (tips.includes(p.id)) reasons.push("this tip");
          if (p.homeTeamApiId != null && teams.includes(p.homeTeamApiId)) reasons.push(p.homeTeam || "a team");
          if (p.awayTeamApiId != null && teams.includes(p.awayTeamApiId)) reasons.push(p.awayTeam || "a team");
          if (p.leagueApiId != null && leagues.includes(p.leagueApiId)) reasons.push(p.leagueName || "its league");
          const followedCategory = categories.find((c) => rowCategories.includes(c));
          if (followedCategory) reasons.push(`${followedCategory.toLowerCase().replace(/_/g, " ")} tips`);
          return <FollowingFeedCard key={p.id} row={p} allowed={allowed} reasons={reasons} href={slug ? `/predictions/match/${slug}` : null} timezone={timezone} now={now} />;
        })}
        {!rows.length && follows.length > 0 && <div className="card text-gray-400">No published predictions currently match your follows.</div>}
        <div className="flex gap-4">
          {page > 1 && <Link className="text-brand" href={`/following?page=${page - 1}`}>← Previous</Link>}
          {rows.length > PAGE_SIZE && <Link className="text-brand" href={`/following?page=${page + 1}`}>Next →</Link>}
        </div>
      </section>
    </div>
  );
}
