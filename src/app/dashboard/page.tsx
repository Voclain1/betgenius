import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "My Account",
  robots: { index: false, follow: false },
};

export default async function AccountDashboard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">My account</h1>
      <div className="card space-y-1">
        <div className="text-sm text-gray-400">Email</div>
        <div>{session.user.email}</div>
      </div>
      <div className="card space-y-2">
        <div className="text-sm text-gray-400">Subscription</div>
        <div className="text-lg font-semibold">{sub?.tier ?? "FREE"} · {sub?.status ?? "ACTIVE"}</div>
        {sub?.currentPeriodEnd && (
          <div className="text-sm text-gray-400">Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</div>
        )}
        <div className="flex gap-2 pt-2">
          <Link href="/pricing" className="btn btn-primary">Upgrade</Link>
          <Link href="/" className="btn btn-ghost">Back to site</Link>
        </div>
      </div>
    </main>
  );
}
