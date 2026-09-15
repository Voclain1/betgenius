import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { PushSettings } from "@/components/PushSettings";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import { MarkNotificationsRead } from "@/components/NotificationBell";

export const metadata = { title: "Notifications", robots: { index: false, follow: false } };

const PAGE_SIZE = 20;

export default async function NotificationsPage({ searchParams }: { searchParams: { page?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) redirect("/login?callbackUrl=%2Fnotifications");
  const page = Math.max(1, Math.floor(Number(searchParams.page)) || 1);
  const rows = await prisma.userNotification.findMany({
    where: { userId: session.user.id },
    include: { event: true },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
  const shown = rows.slice(0, PAGE_SIZE);
  const unreadIds = shown.filter((n) => !n.readAt).map((n) => n.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Notifications</h1>
        <p className="text-gray-400">Your inbox works even when browser push is off.</p>
      </div>
      <MarkNotificationsRead ids={unreadIds} />

      <section className="space-y-2">
        {shown.map((n) => {
          // Re-checked on every view: a lapsed subscription must not keep reading paid-tier detail from its inbox.
          const allowed = !n.event.category || canViewCategory(n.event.category as PredictionCategory, session.user.tier, session.user.subStatus, session.user.role);
          return (
            <Link key={n.id} href={n.event.link} className={`card block ${n.readAt ? "opacity-70" : "border-brand/50"}`}>
              <div className="flex justify-between gap-3">
                <strong>{n.event.title}</strong>
                <time className="shrink-0 text-xs text-gray-500">{n.createdAt.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</time>
              </div>
              <p className="text-sm text-gray-400">{allowed ? n.event.body : "A followed tip has an update."}</p>
            </Link>
          );
        })}
        {!rows.length && <div className="card text-gray-400">No notifications yet. Follow something to personalise this inbox.</div>}
        <div className="flex gap-4">
          {page > 1 && <Link className="text-brand" href={`/notifications?page=${page - 1}`}>← Previous</Link>}
          {rows.length > PAGE_SIZE && <Link className="text-brand" href={`/notifications?page=${page + 1}`}>Next →</Link>}
        </div>
      </section>

      <NotificationPreferences />
      <PushSettings />
    </div>
  );
}
