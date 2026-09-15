import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { FollowButton, type FollowTargetType } from "@/components/FollowButton";
import { matchSlug } from "@/lib/slug";

export const metadata = { title: "Following", robots: { index: false, follow: false } };

const PAGE_SIZE = 20;

export default async function FollowingPage({ searchParams }: { searchParams: { page?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) redirect("/login?callbackUrl=%2Ffollowing");
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);

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
      </div>

      {!follows.length ? (
        <div className="card">
          <p>Follow teams, leagues, tips or categories from prediction pages and Match Insights.</p>
          <Link className="mt-3 inline-block text-brand" href="/match-insights">Explore Match Insights →</Link>
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
          const allowed = canViewCategory(p.category as PredictionCategory, session.user.tier, session.user.subStatus, session.user.role);
          const slug = matchSlug(p);
          const rowCategories = p.categories.map((c) => c.category);
          const reasons: string[] = [];
          if (tips.includes(p.id)) reasons.push("this tip");
          if (p.homeTeamApiId != null && teams.includes(p.homeTeamApiId)) reasons.push(p.homeTeam || "a team");
          if (p.awayTeamApiId != null && teams.includes(p.awayTeamApiId)) reasons.push(p.awayTeam || "a team");
          if (p.leagueApiId != null && leagues.includes(p.leagueApiId)) reasons.push(p.leagueName || "its league");
          const followedCategory = categories.find((c) => rowCategories.includes(c));
          if (followedCategory) reasons.push(`${followedCategory.toLowerCase().replace(/_/g, " ")} tips`);
          return (
            <article key={p.id} className="card">
              <p className="text-xs text-gray-500">Because you follow {reasons.slice(0, 2).join(" and ")}</p>
              <h3 className="font-semibold">{p.homeTeam} vs {p.awayTeam}</h3>
              <p className="text-sm text-gray-400">{p.leagueName}{p.kickoff ? ` · ${p.kickoff.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })} WAT` : ""}</p>
              <p className="mt-2">{allowed ? p.pick : "Locked selection. Following does not change subscription access."}</p>
              {slug && <Link className="text-sm text-brand" href={`/predictions/match/${slug}`}>Open match →</Link>}
            </article>
          );
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
