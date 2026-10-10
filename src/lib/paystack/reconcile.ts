import { attemptOrigin, type AttemptOrigin } from "@/lib/paystack/attemptDiagnosis";
import { referenceAlreadyGranted, type CheckoutDeps } from "@/lib/paystack/applyCheckoutPayment";

/**
 * Compare Paystack's record of each transaction with ours. PLANNING ONLY.
 *
 * This reads the database and writes nothing. It says, per transaction, what
 * would change; acting on it is a separate, explicit step (the admin "Verify &
 * grant" button, or scripts/reconcile-payments.ts --apply), and that step goes
 * through applyCheckoutPayment — the same verified path the webhook uses — so a
 * reconcile can never grant anything the webhook would not have.
 *
 * The question it exists to answer is the P0 one: is there money Paystack says
 * we took, from a BetGenius checkout, with no access to show for it?
 */
export type ReconcileAction =
  /** Nothing to do: not paid, or paid and already granted, or not ours. */
  | "NONE"
  /** Paid at Paystack, ours, no grant recorded. Recoverable by applying. */
  | "GRANT_MISSING"
  /** Paid, ours, but not automatically recoverable — needs a human. */
  | "REVIEW";

export type ReconcileFinding = {
  reference: string;
  paystackStatus: string;
  origin: AttemptOrigin;
  entitled: boolean;
  action: ReconcileAction;
  note: string;
};

type ListedTransaction = {
  reference?: string | null;
  status?: string | null;
  metadata?: { userId?: string | null } | null;
};

export async function planReconciliation(
  transactions: ListedTransaction[],
  db: CheckoutDeps["db"],
): Promise<ReconcileFinding[]> {
  const findings: ReconcileFinding[] = [];
  for (const transaction of transactions) {
    const reference = typeof transaction.reference === "string" ? transaction.reference : null;
    if (!reference) continue;
    const paystackStatus = transaction.status ?? "unknown";
    const userId = typeof transaction.metadata?.userId === "string" ? transaction.metadata.userId : null;
    const origin = attemptOrigin(reference, userId);

    if (paystackStatus !== "success") {
      findings.push({ reference, paystackStatus, origin, entitled: false, action: "NONE", note: "Not paid at Paystack." });
      continue;
    }
    if (origin === "EXTERNAL") {
      findings.push({
        reference,
        paystackStatus,
        origin,
        entitled: false,
        action: "NONE",
        note: "Paid, but not a BetGenius checkout (no bg_ reference, no user metadata). Nothing to grant.",
      });
      continue;
    }

    const entitled = await referenceAlreadyGranted(db, reference);
    if (entitled) {
      findings.push({ reference, paystackStatus, origin, entitled, action: "NONE", note: "Paid and granted." });
      continue;
    }
    // Our own references are recoverable through applyCheckoutPayment
    // wherever they sit. A legacy Paystack-minted one is only recoverable
    // while it is still the pending reference on its owner's row.
    const recoverable =
      origin === "CHECKOUT" ||
      !!(await db.subscription.findFirst({ where: { paystackRef: reference }, select: { userId: true } }));
    findings.push({
      reference,
      paystackStatus,
      origin,
      entitled,
      action: recoverable ? "GRANT_MISSING" : "REVIEW",
      note: recoverable
        ? "P0: paid at Paystack with no entitlement recorded. Apply to verify and grant."
        : "P0: paid legacy checkout no longer pending on any row. Check the customer and grant by hand.",
    });
  }
  return findings;
}
