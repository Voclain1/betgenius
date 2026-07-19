import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PredictionsTable } from "@/components/PredictionsTable";

export const revalidate = 60;

async function fetchFeatured() {
  return prisma.prediction.findMany({
    where: { status: "PUBLISHED", categories: { some: { category: "FEATURED" } } },
    orderBy: { publishedAt: "desc" },
    take: 6,
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
}

export default async function HomePage() {
  const featured = await fetchFeatured();
  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-gradient-to-br from-brand/20 via-brand-card to-brand-bg p-8 md:p-12">
        <h1 className="text-3xl font-bold md:text-5xl">
          Football tips, powered by <span className="text-brand">AI</span>.
        </h1>
        <p className="mt-3 max-w-2xl text-gray-300 md:text-lg">
          Data-driven picks across every major league. Livescores, fixtures, standings, a bet builder and StatsPad — all in one place.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/predictions/today" className="btn btn-primary">Today's tips</Link>
          <Link href="/pricing" className="btn btn-ghost">Go VIP</Link>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Featured tips</h2>
          <Link href="/predictions/featured" className="text-sm text-brand hover:underline">View all →</Link>
        </div>
        {featured.length === 0 ? (
          <p className="text-gray-400">
            No featured tips published yet. Admins can publish tips from{" "}
            <Link href="/admin" className="underline">the dashboard</Link>.
          </p>
        ) : (
          <PredictionsTable rows={featured} />
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link href="/livescores" className="card hover:border-brand">
          <div className="text-brand text-sm font-semibold">LIVE</div>
          <div className="mt-1 text-lg font-semibold">Livescores</div>
          <p className="text-sm text-gray-400">In-play scores across every major league.</p>
        </Link>
        <Link href="/bet-builder" className="card hover:border-brand">
          <div className="text-brand text-sm font-semibold">BUILD</div>
          <div className="mt-1 text-lg font-semibold">Bet builder</div>
          <p className="text-sm text-gray-400">Combine picks, compute your accumulator odds instantly.</p>
        </Link>
        <Link href="/statspad" className="card hover:border-brand">
          <div className="text-brand text-sm font-semibold">STATS</div>
          <div className="mt-1 text-lg font-semibold">StatsPad</div>
          <p className="text-sm text-gray-400">Team form, xG, over/under trends, head-to-head.</p>
        </Link>
      </section>
    </div>
  );
}
