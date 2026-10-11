import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bankDetails, usdtDetails } from "@/lib/payments/methods";
import { manualAmountLabel } from "@/lib/payments/manual";
import { CopyValue, SubmitManualPayment } from "@/components/ManualPaymentActions";

export const metadata: Metadata = { title: "Complete your payment", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TIER_NAME: Record<string, string> = { VIP: "VIP", PREMIUM: "Premium" };

/**
 * Where a bank-transfer / USDT customer pays. Only the owner can open it. The
 * account details come from the environment (lib/payments/methods), so they
 * are never stored per request and change everywhere at once.
 */
export default async function PayPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/pay/${params.id}`)}`);
  const row = await prisma.manualPayment.findUnique({ where: { id: params.id } });
  if (!row || row.userId !== session.user.id) notFound();

  const usdt = row.method === "USDT";
  const amount = manualAmountLabel(row);
  const name = TIER_NAME[row.tier] ?? row.tier;
  const bank = bankDetails();
  const wallet = usdtDetails();
  const rows: [string, string, boolean][] = usdt
    ? [
        ["Network", `USDT on ${wallet.network}`, false],
        ["Wallet address", wallet.address, true],
        ["Amount", amount, false],
        ["Memo / note", row.code, true],
      ]
    : [
        ["Bank", bank.bankName, false],
        ["Account number", bank.accountNumber, true],
        ["Account name", bank.accountName, false],
        ["Amount", amount, false],
        ["Narration", row.code, true],
      ];

  return (
    <div className="mx-auto max-w-xl space-y-6 py-4">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Pay for {name} {usdt ? "with USDT" : "by bank transfer"}</h1>
        <p className="text-gray-300">30 days of {name} for <strong className="text-gray-100">{amount}</strong>. Your plan is activated as soon as we confirm the payment.</p>
      </div>

      <section className="card space-y-1">
        {rows.map(([label, value, copyable]) => (
          <div key={label} className="flex items-center justify-between gap-3 border-b border-brand-border py-2 last:border-0">
            <div className="min-w-0">
              <div className="text-xs text-gray-400">{label}</div>
              <div className="break-all font-semibold text-gray-100">{value}</div>
            </div>
            {copyable && <CopyValue value={value} label={label} />}
          </div>
        ))}
      </section>

      <ul className="space-y-2 text-sm leading-6 text-gray-300">
        {usdt ? (
          <>
            <li>Send exactly <strong className="text-gray-100">{amount}</strong>, on the <strong className="text-gray-100">{wallet.network}</strong> network only. USDT sent on another network can't be recovered.</li>
            <li>Then paste the transaction hash below and tap the button.</li>
          </>
        ) : (
          <>
            <li>Transfer exactly <strong className="text-gray-100">{amount}</strong> and put <strong className="text-gray-100">{row.code}</strong> in the narration, so we can match your payment.</li>
            <li>Then tell us the name on the account you sent from and tap the button.</li>
          </>
        )}
      </ul>

      <section className="card space-y-3">
        {row.status === "APPROVED" ? (
          <>
            <h2 className="text-lg font-semibold text-gray-100">Payment confirmed</h2>
            <p className="text-sm text-gray-300">{name} is active. A receipt is on its way to your email.</p>
            <Link href={row.tier === "PREMIUM" ? "/predictions/premium" : "/predictions/vip"} className="btn btn-primary">Open {name} picks</Link>
          </>
        ) : row.status === "REJECTED" ? (
          <>
            <h2 className="text-lg font-semibold text-gray-100">We couldn&apos;t confirm this payment</h2>
            {row.rejectReason && <p className="text-sm text-gray-300">{row.rejectReason}</p>}
            <p className="text-sm text-gray-400">If you did send the money, contact us with the code {row.code} and your proof of payment.</p>
          </>
        ) : row.status === "SUBMITTED" ? (
          <>
            <h2 className="text-lg font-semibold text-gray-100">We&apos;re checking your payment</h2>
            <p className="text-sm text-gray-300">We confirm payments by hand, usually within a few hours. You&apos;ll get an email as soon as {name} is active. You can correct your details below if needed.</p>
            <SubmitManualPayment id={row.id} method={row.method} initial={row.payerDetails ?? ""} />
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-100">Done paying?</h2>
            <SubmitManualPayment id={row.id} method={row.method} initial="" />
          </>
        )}
      </section>
    </div>
  );
}
