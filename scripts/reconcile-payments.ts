/**
 * Compare Paystack's transactions with BetGenius entitlements.
 *
 *   npm run reconcile:payments                      DRY RUN (default): reads only
 *   npm run reconcile:payments -- --apply <ref>     grant ONE reference, verified
 *
 * THE DRY RUN WRITES NOTHING — not even the observability log. It lists
 * Paystack's transactions (GET), reads subscriptions and the ledger (SELECT),
 * and prints what would change. That is the step to run first, and the output
 * is what a human approves.
 *
 * --apply takes exactly one reference, and goes through applyCheckoutPayment,
 * the webhook's own path: it re-fetches the transaction from Paystack and
 * refuses anything that is not a successful payment of the tier's price, in
 * NGN, by the account's own verified email, with matching userId/tier
 * metadata. It never grants a reference twice. It does not accept a list, so a
 * mistaken invocation can affect one customer at most.
 *
 * Output carries references, statuses and amounts only — no emails, no card or
 * authorization data, and never the secret key.
 */
export {};

async function main() {
  const args = process.argv.slice(2);
  const applyIndex = args.indexOf("--apply");
  const { prisma } = await import("../src/lib/prisma");

  if (applyIndex >= 0) {
    const reference = args[applyIndex + 1];
    if (!reference || reference.startsWith("--")) throw new Error("--apply needs exactly one reference");
    const { applyCheckoutPayment } = await import("../src/lib/paystack/applyCheckoutPayment");
    const result = await applyCheckoutPayment(reference, undefined, "RECONCILE");
    console.log(JSON.stringify({ reference, outcome: result.outcome }));
    await prisma.$disconnect();
    return;
  }

  const { listTransactions } = await import("../src/lib/paystack/paystack");
  const { planReconciliation } = await import("../src/lib/paystack/reconcile");
  const listed = await listTransactions(100);
  const transactions = listed.data ?? [];
  const findings = await planReconciliation(transactions, prisma);

  console.log(`DRY RUN — nothing written. Paystack transactions examined: ${transactions.length}`);
  const tally: Record<string, number> = {};
  for (const f of findings) {
    const key = `${f.paystackStatus} / ${f.origin}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  for (const [key, n] of Object.entries(tally)) console.log(`  ${String(n).padStart(3)}  ${key}`);

  const act = findings.filter((f) => f.action !== "NONE");
  const paid = findings.filter((f) => f.paystackStatus === "success");
  console.log(`\nPaid at Paystack: ${paid.length}`);
  for (const f of paid) console.log(`  ${f.reference}  ${f.origin}  entitled=${f.entitled}  ${f.note}`);
  console.log(`\nWould change: ${act.length}`);
  for (const f of act) console.log(`  ${f.action}  ${f.reference}  ${f.note}`);
  if (act.some((f) => f.action === "GRANT_MISSING")) {
    console.log("\nTo recover one after checking it: npm run reconcile:payments -- --apply <reference>");
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("reconcile failed:", error instanceof Error ? error.message.replace(/sk_(live|test)_\w+/g, "sk_***") : error);
  process.exit(1);
});
