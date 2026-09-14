import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PushSettings } from "@/components/PushSettings";
import { NotificationPreferences } from "@/components/NotificationPreferences";

export const metadata = { title: "Notifications", robots: { index: false, follow: false } };

export default async function NotificationsPage({ searchParams }: { searchParams: { page?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user.id) redirect("/login?callbackUrl=%2Fnotifications");
  const page = Math.max(1, Number(searchParams.page) || 1), take = 20;
  const rows = await prisma.userNotification.findMany({ where: { userId: session.user.id }, include: { event: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take: take + 1 });
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold">Notifications</h1><p className="text-gray-400">Your inbox works even when browser push is off.</p></div>
    <NotificationPreferences />
    <PushSettings />
    <section className="space-y-2">
      {rows.slice(0, take).map(n => <Link key={n.id} href={n.event.link} className={`card block ${n.readAt ? "opacity-70" : "border-brand/50"}`}><div className="flex justify-between gap-3"><strong>{n.event.title}</strong><time className="text-xs text-gray-500">{n.createdAt.toLocaleString()}</time></div><p className="text-sm text-gray-400">{n.event.body}</p></Link>)}
      {!rows.length && <div className="card text-gray-400">No notifications yet. Follow something to personalise this inbox.</div>}
      <div className="flex gap-4">{page > 1 && <Link href={`/notifications?page=${page - 1}`}>Previous</Link>}{rows.length > take && <Link href={`/notifications?page=${page + 1}`}>Next</Link>}</div>
    </section>
  </div>;
}
