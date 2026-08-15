import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewCategory } from "@/lib/access";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { CATEGORY_SLUGS as SLUGS, CATEGORY_NAMES as NAMES, getCategoryPredictions } from "@/lib/categoryPredictions";
import { matchSlug } from "@/lib/slug";
import { JsonLd, breadcrumbJsonLd, sportsEventJsonLd } from "@/lib/seo";

export async function generateMetadata({ params }: { params: { category: string } }): Promise<Metadata> {
  const cat = SLUGS[params.category];
  if (!cat) return {};
  const name = NAMES[cat];
  const rows = await getCategoryPredictions(cat);

  // Thin/empty content shouldn't claim a rich, specific title as if it had
  // real picks to show — and search engines shouldn't index a page with
  // nothing on it yet.
  if (rows.length === 0) {
    return {
      title: name,
      description: `No ${name.toLowerCase()} published yet — check back soon for AI-powered football predictions.`,
      robots: { index: false, follow: true },
      alternates: { canonical: `/predictions/${params.category}` },
    };
  }

  const sample = rows
    .slice(0, 3)
    .map((r) => (r.homeTeam ? `${r.homeTeam} vs ${r.awayTeam}` : r.fixture ? `${r.fixture.homeTeam?.name} vs ${r.fixture.awayTeam?.name}` : null))
    .filter(Boolean)
    .join(", ");

  return {
    title: name,
    description: `${rows.length} live ${name.toLowerCase()}${sample ? ` — including ${sample}` : ""}. AI-powered football predictions updated daily.`,
    alternates: { canonical: `/predictions/${params.category}` },
  };
}

export default async function CategoryPage({ params }: { params: { category: string } }) {
  const cat = SLUGS[params.category];
  if (!cat) return notFound();

  const session = await getServerSession(authOptions);
  const canView = canViewCategory(cat, session?.user.tier, session?.user.subStatus, session?.user.role);

  const rows = await getCategoryPredictions(cat);

  const needsRegistration = !canView && cat === "BANKER" && !session?.user;
  const lockReason = needsRegistration
    ? "Sign up free to unlock this tip and full reasoning."
    : "Subscribe to VIP or Premium to unlock this tip and full reasoning.";

  // Badge reflects the feed being browsed, not necessarily the tip's stored
  // primary category — a tip can be cross-posted into multiple feeds.
  const shaped = rows.map((r) =>
    canView
      ? { ...r, category: cat }
      : {
          ...r,
          category: cat,
          pick: "LOCKED",
          reasoning: lockReason,
          matchPreview: null,
          confidence: null,
          odds: null,
          locked: true,
        },
  );

  const slug = params.category;
  const events = rows
    .map((r) => {
      const home = r.homeTeam ?? r.fixture?.homeTeam?.name;
      const away = r.awayTeam ?? r.fixture?.awayTeam?.name;
      if (!home || !away) return null;
      const kickoff = r.kickoff ?? r.fixture?.kickoff ?? null;
      // url points at the match page, so the SportsEvent resolves to the one
      // page that collects every market for the fixture rather than to a feed.
      const slug = matchSlug({ homeTeam: home, awayTeam: away, kickoff });
      return sportsEventJsonLd({
        homeTeam: home,
        awayTeam: away,
        kickoff,
        league: r.leagueName ?? r.fixture?.league?.name,
        ...(slug ? { url: `/predictions/match/${slug}` } : {}),
      });
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  return (
    <div className="space-y-6">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name: NAMES[cat], path: `/predictions/${slug}` },
          ]),
          ...events,
        ]}
      />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{NAMES[cat]}</h1>
          <p className="text-sm text-gray-400">{shaped.length} live picks</p>
        </div>
        {!canView && (cat === "VIP" || cat === "PREMIUM") && (
          <Link href="/pricing" className="btn btn-primary">Unlock {cat === "VIP" ? "VIP" : "Premium"}</Link>
        )}
        {needsRegistration && (
          <Link href="/register" className="btn btn-primary">Sign up free</Link>
        )}
      </div>

      <CategoryPredictionsList category={cat} rows={shaped as any} />
    </div>
  );
}
