import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { updatesCounts } from "@/lib/predictionUpdates";

export default async function AdminHome() {
  const [pendingReview, published, activeSubs, pendingSubs, pendingAdmins, updates] = await Promise.all([
    prisma.prediction.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.prediction.count({ where: { status: "PUBLISHED" } }),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { role: "ADMIN_PENDING" } }),
    updatesCounts(new Date()),
  ]);
  const stats = [
    { label: "Pending review", value: pendingReview },
    { label: "Published tips", value: published },
    { label: "Active subs", value: activeSubs },
    { label: "Pending subs", value: pendingSubs },
    { label: "Admin requests", value: pendingAdmins },
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Overview</h1>
      <Link href="/admin/updates" className="card flex items-center justify-between gap-4 hover:bg-white/5">
        <div>
          <div className="text-xs text-gray-400">Updates needing approval</div>
          <div className="text-2xl font-bold">{updates.needingApproval}</div>
          {updates.awaitingDecision > 0 && <div className="text-xs text-amber-300">{updates.awaitingDecision} awaiting your decision</div>}
        </div>
        <span className="text-sm text-gray-300">Open prediction updates →</span>
      </Link>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
