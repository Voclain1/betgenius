import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updatesCounts } from "@/lib/predictionUpdates";
import { loadReviewQueue } from "@/lib/reviewQueue";

export default async function AdminHome() {
  const [queue, published, activeSubs, pendingSubs, pendingAdmins, updates] = await Promise.all([
    loadReviewQueue(),
    prisma.prediction.count({ where: { status: "PUBLISHED" } }),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { role: "ADMIN_PENDING" } }),
    updatesCounts(new Date()),
  ]);
  const stats = [
    { label: "Published tips", value: published },
    { label: "Active subs", value: activeSubs },
    { label: "Pending subs", value: pendingSubs },
    { label: "Admin requests", value: pendingAdmins },
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Overview</h1>
      <Link href="/admin/review" className="card flex items-center justify-between gap-4 hover:bg-white/5">
        <div>
          <div className="text-xs text-gray-400">Review queue</div>
          <div className="text-2xl font-bold">{queue.ready.length + queue.attention.length} <span className="text-base font-normal text-gray-400">waiting</span></div>
          <div className="mt-1 text-sm text-gray-300">{queue.ready.length} ready to publish · {queue.attention.length} need attention</div>
          {updates.awaitingDecision > 0 && <div className="mt-1 text-sm text-amber-300">{updates.awaitingDecision} published pick{updates.awaitingDecision === 1 ? "" : "s"} need a keep-or-withdraw decision</div>}
        </div>
        <span className="text-sm text-gray-300">Open review queue →</span>
      </Link>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="text-xs text-gray-400">{s.label}</div>
            <div className="text-2xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
