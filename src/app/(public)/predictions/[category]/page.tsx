import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { PredictionCard } from "@/components/PredictionCard";
import { PredictionsTable } from "@/components/PredictionsTable";
import type { PredictionCategory } from "@/lib/enums";

const SLUGS: Record<string, PredictionCategory> = {
  featured: "FEATURED",
  genius: "GENIUS",
  today: "TODAY",
  banker: "BANKER",
  vip: "VIP",
  premium: "PREMIUM",
};

const NAMES: Record<PredictionCategory, string> = {
  FEATURED: "Featured tips",
  GENIUS: "Genius tips",
  TODAY: "Today's predictions",
  BANKER: "Banker",
  VIP: "VIP tips",
  PREMIUM: "Premium tips",
};

export default async function CategoryPage({ params }: { params: { category: string } }) {
  const cat = SLUGS[params.category];
  if (!cat) return notFound();

  const session = await getServerSession(authOptions);
  const canView = canViewCategory(cat, session?.user.tier, session?.user.subStatus, session?.user.role);

  const rows = await prisma.prediction.findMany({
    where: { status: "PUBLISHED", categories: { some: { category: cat } } },
    orderBy: { publishedAt: "desc" },
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
    take: 60,
  });

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

  return (
    <div className="space-y-6">
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

      {shaped.length === 0 ? (
        <div className="card text-gray-400">No published tips in this category yet.</div>
      ) : cat === "TODAY" ? (
        <PredictionsTable rows={shaped as any} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shaped.map((p) => (
            <PredictionCard key={p.id} p={p as any} />
          ))}
        </div>
      )}
    </div>
  );
}
