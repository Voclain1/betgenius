import { prisma } from "@/lib/prisma";

export default async function AdminHome() {
  const [pendingReview, published, activeSubs, pendingSubs, pendingAdmins] = await Promise.all([
    prisma.prediction.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.prediction.count({ where: { status: "PUBLISHED" } }),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { role: "ADMIN_PENDING" } }),
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
