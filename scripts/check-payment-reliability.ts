/**
 * Payment reliability regressions — the whole grant flow, not just its rules.
 *
 * check-onetime-fallback.ts asserts the pure grant RULE. This drives the real
 * applyCheckoutPayment — lookup, Paystack verification, the ledger claim, the
 * compare-and-set write and the retry — against an in-memory stand-in for the
 * database and a scripted stand-in for Paystack, because that orchestration is
 * where the two production risks live:
 *
 *   1. A SUPERSEDED CHECKOUT. A payer who starts a second checkout and then
 *      completes the first (an old tab, a bank transfer that settles late)
 *      presented a reference no subscription row knew. It fell through to the
 *      recurring path and, if the tiers differed, was refused: charged, no
 *      access.
 *   2. A DOUBLE GRANT. lastPaymentRef remembers only the latest payment, so an
 *      earlier reference redelivered after a later one had been applied looked
 *      unspent. The ledger (PaymentAttempt.entitlementGrantedAt) closes that.
 *
 * The stand-in serialises transactions (as row locks would) and rolls a
 * transaction back when it throws, so the compare-and-set and ledger races are
 * exercised for real rather than assumed.
 *
 * NO REAL PAYMENT, NO NETWORK, NO DATABASE.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

process.env.PAYSTACK_SECRET_KEY = "sk_test_reliability_fixture";

import { applyCheckoutPayment, type CheckoutDeps } from "../src/lib/paystack/applyCheckoutPayment";
import { toSafePaymentAttempt } from "../src/lib/paystack/recordPaymentAttempt";
import { newCheckoutReference } from "../src/lib/paystack/checkoutReference";
import { PAID_PERIOD_MS } from "../src/lib/paystack/entitlement";
import { planReconciliation } from "../src/lib/paystack/reconcile";
import { recordCheckoutStart } from "../src/lib/paystack/recordCheckoutStart";
import { verifyPaystackSignature } from "../src/lib/paystack/verifySignature";
import { koboFor } from "../src/lib/pricing";
import { classifyPaymentAttempt } from "../src/lib/paystack/failureCategory";

const NOW = new Date("2026-09-29T15:19:11.000Z");
const DAY = 24 * 60 * 60 * 1000;
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// The stand-ins.
// ---------------------------------------------------------------------------
type Sub = {
  userId: string;
  email: string;
  tier: string;
  status: string;
  paystackRef: string | null;
  lastPaymentRef: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.()
    : a === b;

// The subset of Prisma's filter language the payment code uses: equality
// (null means IS NULL), in, gt, lte, not, and nested OR / AND / NOT.
function cond(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === "object" && !(condition instanceof Date)) {
    const c = condition as Record<string, any>;
    if ("in" in c) return c.in.includes(value);
    if ("gt" in c) return value instanceof Date && value.getTime() > c.gt.getTime();
    if ("lte" in c) return value instanceof Date && value.getTime() <= c.lte.getTime();
    if ("not" in c) return !same(value ?? null, c.not ?? null);
  }
  return same(value ?? null, condition ?? null);
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((w) => matches(row, w));
    if (key === "AND") return (value as Record<string, unknown>[]).every((w) => matches(row, w));
    if (key === "NOT") return !matches(row, value as Record<string, unknown>);
    return cond(row[key], value);
  });
}

/**
 * An in-memory stand-in with the concurrency semantics that matter here.
 *
 * Every single statement is atomic. Writes outside a transaction are
 * serialised against transactions, as a Postgres row lock would make them —
 * without that, a write could land in the middle of a transaction and then be
 * erased by its rollback, which no real database does. Reads never wait.
 * A transaction that throws is rolled back to the state it started from.
 */
class FakeDb {
  subs = new Map<string, Sub>();
  attempts = new Map<string, Record<string, any>>();
  private queue: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private project = (s: Sub) => ({ ...s, user: { email: s.email } });

  private rawSubscription = {
    findMany: async ({ where, take }: any) => {
      await tick();
      return [...this.subs.values()].filter((s) => matches(s, where)).slice(0, take ?? Infinity).map(this.project);
    },
    findFirst: async ({ where }: any) => {
      await tick();
      const found = [...this.subs.values()].find((s) => matches(s, where));
      return found ? this.project(found) : null;
    },
    findUnique: async ({ where }: any) => {
      await tick();
      const found = this.subs.get(where.userId);
      return found ? this.project(found) : null;
    },
    updateMany: async ({ where, data }: any) => {
      await tick();
      let count = 0;
      for (const s of this.subs.values()) {
        if (matches(s, where)) {
          Object.assign(s, data);
          count++;
        }
      }
      return { count };
    },
    create: async ({ data }: any) => {
      await tick();
      if (this.subs.has(data.userId)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      const row: Sub = {
        email: `${data.userId}@example.com`,
        tier: "FREE",
        status: "PENDING",
        paystackRef: null,
        lastPaymentRef: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        ...data,
      };
      this.subs.set(data.userId, row);
      return this.project(row);
    },
    upsert: async ({ where, update, create }: any) => {
      await tick();
      const found = this.subs.get(where.userId);
      if (found) {
        Object.assign(found, update);
        return this.project(found);
      }
      return this.rawSubscription.create({ data: create });
    },
  };

  private rawPaymentAttempt = {
    findUnique: async ({ where }: any) => {
      await tick();
      return this.attempts.get(where.reference) ?? null;
    },
    updateMany: async ({ where, data }: any) => {
      await tick();
      const row = this.attempts.get(where.reference);
      if (!row || !matches(row, where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    create: async ({ data }: any) => {
      await tick();
      if (this.attempts.has(data.reference)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      this.attempts.set(data.reference, { entitlementGrantedAt: null, ...data });
      return data;
    },
  };

  private locked<T extends Record<string, (...args: any[]) => Promise<any>>>(raw: T, writes: (keyof T)[]): T {
    return Object.fromEntries(
      Object.entries(raw).map(([name, fn]) => [
        name,
        writes.includes(name as keyof T) ? (...args: any[]) => this.serial(() => fn(...args)) : fn,
      ]),
    ) as T;
  }

  subscription = this.locked(this.rawSubscription, ["updateMany", "create", "upsert"]);
  paymentAttempt = this.locked(this.rawPaymentAttempt, ["updateMany", "create"]);

  // One transaction at a time, and a throw restores the state it started from.
  $transaction = (fn: (tx: any) => Promise<unknown>) =>
    this.serial(async () => {
      const subs = new Map([...this.subs].map(([k, v]) => [k, { ...v }]));
      const attempts = new Map([...this.attempts].map(([k, v]) => [k, { ...v }]));
      try {
        return await fn({ subscription: this.rawSubscription, paymentAttempt: this.rawPaymentAttempt });
      } catch (error) {
        this.subs = subs;
        this.attempts = attempts;
        throw error;
      }
    });
}

/**
 * The same database, except that after this caller's Nth subscription
 * statement completes it waits for `gate` before continuing. Used to hold one
 * party exactly between two of its statements while another commits.
 */
function pausedAfter(db: FakeDb, statement: number, gate: Promise<void>) {
  let seen = 0;
  const subscription = Object.fromEntries(
    Object.entries(db.subscription).map(([name, fn]) => [
      name,
      async (...args: any[]) => {
        const result = await (fn as (...a: any[]) => Promise<any>)(...args);
        if (++seen === statement) await gate;
        return result;
      },
    ]),
  );
  return new Proxy(db, { get: (target, key) => (key === "subscription" ? subscription : (target as any)[key]) });
}

type Txn = Record<string, any>;

function world() {
  const db = new FakeDb();
  const paystack = new Map<string, Txn>();
  const rejections: { reference: string; codes: string[] }[] = [];
  const verifyFailures: string[] = [];
  let verifyCalls = 0;
  // References whose Paystack response is held back, to force a race.
  const slow = new Map<string, number>();
  const deps: CheckoutDeps = {
    db: db as unknown as CheckoutDeps["db"],
    verify: async (reference) => {
      verifyCalls++;
      for (let i = 0; i < (slow.get(reference) ?? 1); i++) await tick();
      const data = paystack.get(reference);
      if (!data) throw new Error("Transaction reference not found");
      return { data };
    },
    // The same allowlisted extraction production uses, into the stand-in.
    record: async (transaction, source, fallback) => {
      const safe = toSafePaymentAttempt(transaction, fallback);
      if (!safe) return;
      const existing = db.attempts.get(safe.reference);
      db.attempts.set(safe.reference, { entitlementGrantedAt: null, ...existing, ...safe, source });
    },
    recordVerifyFailure: async (reference) => {
      verifyFailures.push(reference);
    },
    recordRejection: async (reference, codes) => {
      rejections.push({ reference, codes });
    },
    now: () => NOW,
  };
  const addUser = (userId: string, sub: Partial<Sub> = {}) =>
    db.subs.set(userId, {
      userId,
      email: `${userId}@example.com`,
      tier: "FREE",
      status: "PENDING",
      paystackRef: null,
      lastPaymentRef: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      ...sub,
    });
  // What the initialize route does: new reference on the row, row otherwise
  // left alone when it has live paid access.
  const startCheckout = (userId: string, tier: "VIP" | "PREMIUM") => {
    const reference = newCheckoutReference(tier);
    const sub = db.subs.get(userId)!;
    const live = sub.status === "ACTIVE" && !!sub.currentPeriodEnd && sub.currentPeriodEnd > NOW;
    Object.assign(sub, live ? { paystackRef: reference } : { tier, status: "PENDING", paystackRef: reference });
    return reference;
  };
  // What Paystack's /transaction/verify returns for a checkout.
  const paystackSays = (reference: string, userId: string, tier: "VIP" | "PREMIUM", over: Txn = {}) =>
    paystack.set(reference, {
      reference,
      status: "success",
      gateway_response: "Approved",
      channel: "bank_transfer",
      currency: "NGN",
      amount: koboFor(tier),
      paid_at: NOW.toISOString(),
      created_at: NOW.toISOString(),
      customer: { email: `${userId}@example.com` },
      metadata: { userId, tier },
      ...over,
    });
  return {
    db,
    deps,
    paystack,
    slow,
    rejections,
    verifyFailures,
    addUser,
    startCheckout,
    paystackSays,
    verifyCalls: () => verifyCalls,
  };
}

async function main() {
  // -------------------------------------------------------------------------
  // 1. The price is the server's, in kobo.
  // -------------------------------------------------------------------------
  assert.equal(koboFor("VIP"), 2_000_000, "₦20,000 is 2,000,000 kobo");
  assert.equal(koboFor("PREMIUM"), 5_000_000, "₦50,000 is 5,000,000 kobo");
  const references = new Set(Array.from({ length: 2000 }, () => newCheckoutReference("VIP")));
  assert.equal(references.size, 2000, "every checkout gets its own reference; a retry cannot collide");

  // -------------------------------------------------------------------------
  // 2. A successful payment grants exactly one 30-day period — VIP and Premium.
  // -------------------------------------------------------------------------
  for (const tier of ["VIP", "PREMIUM"] as const) {
    const w = world();
    w.addUser("u1");
    const ref = w.startCheckout("u1", tier);
    w.paystackSays(ref, "u1", tier);
    const result = await applyCheckoutPayment(ref, undefined, "WEBHOOK", w.deps);
    assert.equal(result.outcome, "GRANTED", `a verified ${tier} payment is granted`);
    const sub = w.db.subs.get("u1")!;
    assert.equal(sub.tier, tier);
    assert.equal(sub.status, "ACTIVE");
    assert.equal(sub.currentPeriodEnd!.getTime(), NOW.getTime() + PAID_PERIOD_MS, "exactly 30 days");
    assert.equal(sub.paystackRef, null, "the checkout reference is spent");
    assert.equal(sub.lastPaymentRef, ref);
    assert(w.db.attempts.get(ref)?.entitlementGrantedAt, "the ledger records the grant");

    // Duplicate webhook, then a late callback: both no-ops.
    assert.equal((await applyCheckoutPayment(ref, undefined, "WEBHOOK", w.deps)).outcome, "ALREADY_GRANTED");
    assert.equal((await applyCheckoutPayment(ref, "u1", "CALLBACK", w.deps)).outcome, "ALREADY_GRANTED");
    assert.equal(
      w.db.subs.get("u1")!.currentPeriodEnd!.getTime(),
      NOW.getTime() + PAID_PERIOD_MS,
      "a duplicate webhook or callback never extends the period",
    );
  }

  // -------------------------------------------------------------------------
  // 3. Webhook and callback arriving together grant once.
  // -------------------------------------------------------------------------
  {
    const w = world();
    w.addUser("u1");
    const ref = w.startCheckout("u1", "VIP");
    w.paystackSays(ref, "u1", "VIP");
    const outcomes = await Promise.all([
      applyCheckoutPayment(ref, undefined, "WEBHOOK", w.deps),
      applyCheckoutPayment(ref, "u1", "CALLBACK", w.deps),
      applyCheckoutPayment(ref, undefined, "WEBHOOK", w.deps),
    ]);
    assert.equal(outcomes.filter((o) => o.outcome === "GRANTED").length, 1, "exactly one concurrent caller grants");
    assert(outcomes.every((o) => o.outcome === "GRANTED" || o.outcome === "ALREADY_GRANTED"));
    assert.equal(w.db.subs.get("u1")!.currentPeriodEnd!.getTime(), NOW.getTime() + PAID_PERIOD_MS);
  }

  // -------------------------------------------------------------------------
  // 4. Nothing but a verified success of the right shape grants anything.
  // -------------------------------------------------------------------------
  const refusals: [string, Txn, string][] = [
    ["amount mismatch", { amount: koboFor("VIP") - 100 }, "AMOUNT_MISMATCH"],
    ["currency mismatch", { currency: "USD" }, "CURRENCY_MISMATCH"],
    ["another customer's email", { customer: { email: "someone@example.com" } }, "CUSTOMER_MISMATCH"],
    ["tier escalated in metadata", { metadata: { userId: "u1", tier: "PREMIUM" } }, "TIER_MISMATCH"],
  ];
  for (const [label, over, code] of refusals) {
    const w = world();
    w.addUser("u1");
    const ref = w.startCheckout("u1", "VIP");
    w.paystackSays(ref, "u1", "VIP", over);
    const result = await applyCheckoutPayment(ref, undefined, "WEBHOOK", w.deps);
    assert.equal(result.outcome, "REJECTED", `${label} is refused`);
    assert(w.rejections.some((r) => r.codes.includes(code)), `${label} is recorded as ${code} for the admin view`);
    assert.equal(w.db.subs.get("u1")!.status, "PENDING", `${label} grants nothing`);
    assert(!w.db.attempts.get(ref)?.entitlementGrantedAt, `${label} claims no ledger entry`);
  }

  // Unsuccessful transactions: refused, reported with Paystack's status so the
  // payer's page can offer a retry, and NOT flagged as a paid-but-refused P0.
  const unpaid: [string, Txn, string][] = [
    ["abandoned", { status: "abandoned", gateway_response: "The transaction was not completed", paid_at: null }, "ABANDONED"],
    ["fraud block", { status: "failed", gateway_response: "Denied by Fraud System.", paid_at: null }, "FRAUD_BLOCK"],
    ["bank decline", { status: "failed", gateway_response: "Declined", paid_at: null }, "ISSUER_DECLINE"],
    ["pending transfer", { status: "pending", gateway_response: "Transaction in progress", paid_at: null }, "PENDING"],
  ];
  for (const [label, over, category] of unpaid) {
    const w = world();
    w.addUser("u1");
    const ref = w.startCheckout("u1", "VIP");
    w.paystackSays(ref, "u1", "VIP", over);
    const result = await applyCheckoutPayment(ref, "u1", "CALLBACK", w.deps);
    assert.equal(result.outcome, "REJECTED", `${label} grants nothing`);
    assert.equal(result.outcome === "REJECTED" && result.paystackStatus, over.status, `${label} reports Paystack's status`);
    assert.equal(w.rejections.length, 0, `${label} is not a paid-but-refused P0`);
    assert.equal(w.db.attempts.get(ref)?.category, category, `${label} is classified ${category}`);
    assert.equal(w.db.subs.get("u1")!.status, "PENDING");
  }

  // Invalid references.
  {
    const w = world();
    w.addUser("u1");
    assert.equal(
      (await applyCheckoutPayment("T000000000000", undefined, "WEBHOOK", w.deps)).outcome,
      "NOT_A_CHECKOUT",
      "an unknown non-BetGenius reference is not a checkout",
    );
    const ghost = newCheckoutReference("VIP");
    const result = await applyCheckoutPayment(ghost, undefined, "WEBHOOK", w.deps);
    assert.equal(result.outcome, "VERIFICATION_FAILED", "a reference Paystack does not know fails verification");
    assert.deepEqual(w.verifyFailures, [ghost], "and the failure is recorded for the admin view");
    assert.equal(w.db.subs.get("u1")!.status, "PENDING");
  }

  // Callback cannot claim someone else's payment.
  {
    const w = world();
    w.addUser("payer");
    w.addUser("thief");
    const ref = w.startCheckout("payer", "VIP");
    w.paystackSays(ref, "payer", "VIP");
    assert.equal((await applyCheckoutPayment(ref, "thief", "CALLBACK", w.deps)).outcome, "NOT_A_CHECKOUT");
    assert.equal(w.db.subs.get("thief")!.status, "PENDING", "another user's reference grants the caller nothing");
    assert.equal(w.db.subs.get("payer")!.status, "PENDING", "nor does it grant the payer via the wrong session");
  }

  // -------------------------------------------------------------------------
  // 5. Retry after an abandoned checkout: the retry pays, the abandoned one
  //    never does.
  // -------------------------------------------------------------------------
  {
    const w = world();
    w.addUser("u1");
    const first = w.startCheckout("u1", "VIP");
    w.paystackSays(first, "u1", "VIP", { status: "abandoned", gateway_response: "The transaction was not completed" });
    assert.equal((await applyCheckoutPayment(first, "u1", "CALLBACK", w.deps)).outcome, "REJECTED");
    const retry = w.startCheckout("u1", "VIP");
    assert.notEqual(retry, first, "the retry is a new reference");
    w.paystackSays(retry, "u1", "VIP");
    assert.equal((await applyCheckoutPayment(retry, undefined, "WEBHOOK", w.deps)).outcome, "GRANTED");
    assert.equal(w.db.subs.get("u1")!.currentPeriodEnd!.getTime(), NOW.getTime() + PAID_PERIOD_MS);
    // The abandoned reference, presented again later, still grants nothing.
    assert.equal((await applyCheckoutPayment(first, undefined, "WEBHOOK", w.deps)).outcome, "REJECTED");
    assert.equal(w.db.subs.get("u1")!.currentPeriodEnd!.getTime(), NOW.getTime() + PAID_PERIOD_MS);
  }

  // -------------------------------------------------------------------------
  // 6. THE SUPERSEDED CHECKOUT. VIP started, then Premium started, then the
  //    VIP page completed. Before: 409, charged, no access. Now: VIP granted,
  //    Premium checkout left in flight.
  // -------------------------------------------------------------------------
  {
    const w = world();
    w.addUser("u1");
    const vip = w.startCheckout("u1", "VIP");
    const premium = w.startCheckout("u1", "PREMIUM");
    w.paystackSays(vip, "u1", "VIP");
    const result = await applyCheckoutPayment(vip, undefined, "WEBHOOK", w.deps);
    assert.equal(result.outcome, "GRANTED", "paying an earlier checkout after starting another is granted");
    let sub = w.db.subs.get("u1")!;
    assert.equal(sub.tier, "VIP", "for the tier that was actually paid for");
    assert.equal(sub.currentPeriodEnd!.getTime(), NOW.getTime() + PAID_PERIOD_MS);
    assert.equal(sub.paystackRef, premium, "the newer checkout stays in flight");

    // Redelivery of the superseded one: no-op.
    assert.equal((await applyCheckoutPayment(vip, undefined, "WEBHOOK", w.deps)).outcome, "ALREADY_GRANTED");

    // Then the Premium one is paid too: a second, separate period.
    w.paystackSays(premium, "u1", "PREMIUM");
    assert.equal((await applyCheckoutPayment(premium, "u1", "CALLBACK", w.deps)).outcome, "GRANTED");
    sub = w.db.subs.get("u1")!;
    assert.equal(sub.tier, "PREMIUM");
    assert.equal(sub.currentPeriodEnd!.getTime(), NOW.getTime() + 2 * PAID_PERIOD_MS, "two payments, two periods");
    assert.equal(sub.lastPaymentRef, premium);

    // THE DOUBLE-GRANT REGRESSION: the VIP reference redelivered now that
    // lastPaymentRef has moved on. Only the ledger remembers it.
    assert.equal((await applyCheckoutPayment(vip, undefined, "WEBHOOK", w.deps)).outcome, "ALREADY_GRANTED");
    assert.equal((await applyCheckoutPayment(vip, "u1", "CALLBACK", w.deps)).outcome, "ALREADY_GRANTED");
    assert.equal(
      w.db.subs.get("u1")!.currentPeriodEnd!.getTime(),
      NOW.getTime() + 2 * PAID_PERIOD_MS,
      "an earlier reference never buys a second period after a later one is applied",
    );
  }

  // A superseded reference is held to every check a current one is.
  {
    const w = world();
    w.addUser("u1");
    const vip = w.startCheckout("u1", "VIP");
    w.startCheckout("u1", "PREMIUM");
    w.paystackSays(vip, "u1", "VIP", { amount: koboFor("VIP") - 1 });
    assert.equal((await applyCheckoutPayment(vip, undefined, "WEBHOOK", w.deps)).outcome, "REJECTED");
    assert(w.rejections.some((r) => r.codes.includes("AMOUNT_MISMATCH")));

    const w2 = world();
    w2.addUser("u1");
    w2.addUser("u2");
    const stale = w2.startCheckout("u1", "VIP");
    w2.startCheckout("u1", "VIP");
    // Metadata points at u2, but the verified customer is u1: refused.
    w2.paystackSays(stale, "u1", "VIP", { metadata: { userId: "u2", tier: "VIP" } });
    assert.equal((await applyCheckoutPayment(stale, undefined, "WEBHOOK", w2.deps)).outcome, "REJECTED");
    assert(w2.rejections.some((r) => r.codes.includes("CUSTOMER_MISMATCH")));
    assert.equal(w2.db.subs.get("u2")!.status, "PENDING", "metadata alone never moves a payment to another account");
    // And a signed-in user cannot claim someone else's superseded reference.
    w2.paystackSays(stale, "u1", "VIP");
    assert.equal((await applyCheckoutPayment(stale, "u2", "CALLBACK", w2.deps)).outcome, "NOT_A_CHECKOUT");
  }

  // Two different payments for one account landing at once: both count. The
  // compare-and-set on the period end makes the loser re-read and extend from
  // the winner's end, rather than both extending from the same start.
  {
    const w = world();
    w.addUser("u1");
    const a = w.startCheckout("u1", "VIP");
    const b = w.startCheckout("u1", "VIP");
    w.paystackSays(a, "u1", "VIP");
    w.paystackSays(b, "u1", "VIP");
    // Both callers read the row before either writes: the current checkout
    // reads it first, then waits on Paystack while the superseded one reads,
    // writes and commits.
    w.slow.set(b, 40);
    const outcomes = await Promise.all([
      applyCheckoutPayment(a, undefined, "WEBHOOK", w.deps),
      applyCheckoutPayment(b, undefined, "WEBHOOK", w.deps),
    ]);
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ["GRANTED", "GRANTED"]);
    assert.equal(
      w.db.subs.get("u1")!.currentPeriodEnd!.getTime(),
      NOW.getTime() + 2 * PAID_PERIOD_MS,
      "two concurrent payments buy two periods, not one",
    );
  }

  // An early renewal by an ACTIVE subscriber keeps the time already paid for.
  {
    const w = world();
    const end = new Date(NOW.getTime() + 10 * DAY);
    w.addUser("u1", { tier: "VIP", status: "ACTIVE", currentPeriodStart: new Date(NOW.getTime() - 20 * DAY), currentPeriodEnd: end });
    const ref = w.startCheckout("u1", "VIP");
    assert.equal(w.db.subs.get("u1")!.status, "ACTIVE", "starting a renewal does not revoke access");
    w.paystackSays(ref, "u1", "VIP");
    assert.equal((await applyCheckoutPayment(ref, undefined, "WEBHOOK", w.deps)).outcome, "GRANTED");
    assert.equal(w.db.subs.get("u1")!.currentPeriodEnd!.getTime(), end.getTime() + PAID_PERIOD_MS);
  }

  // -------------------------------------------------------------------------
  // 7. Reconciliation: find paid-without-access, recover it through the
  //    verified path, and never double-grant.
  // -------------------------------------------------------------------------
  {
    const w = world();
    w.addUser("u1");
    const lost = w.startCheckout("u1", "PREMIUM");
    w.paystackSays(lost, "u1", "PREMIUM");
    // The webhook never arrived and the payer never came back: nothing granted.
    const listing = [
      w.paystack.get(lost)!,
      { reference: "T196391549214648", status: "success", amount: 10_500, metadata: null },
      { reference: newCheckoutReference("VIP"), status: "abandoned", metadata: { userId: "u1" } },
      { reference: "probe_render_1789746106", status: "abandoned", metadata: null },
    ];
    let plan = await planReconciliation(listing, w.deps.db);
    const byRef = new Map(plan.map((f) => [f.reference, f]));
    assert.equal(byRef.get(lost)!.action, "GRANT_MISSING", "a paid BetGenius checkout with no access is flagged P0");
    assert.equal(byRef.get("T196391549214648")!.action, "NONE", "a payment BetGenius never initialised is not ours to grant");
    assert.equal(byRef.get("T196391549214648")!.origin, "EXTERNAL");
    assert.equal(byRef.get("probe_render_1789746106")!.origin, "EXTERNAL", "test probes are not customer checkouts");
    assert.equal(plan.filter((f) => f.action !== "NONE").length, 1);
    assert.equal(w.db.subs.get("u1")!.status, "PENDING", "planning changes nothing");
    assert.equal(w.verifyCalls(), 0, "planning does not even call Paystack");

    assert.equal((await applyCheckoutPayment(lost, undefined, "RECONCILE", w.deps)).outcome, "GRANTED");
    assert.equal(w.db.subs.get("u1")!.tier, "PREMIUM");
    plan = await planReconciliation(listing, w.deps.db);
    assert.equal(plan.find((f) => f.reference === lost)!.action, "NONE", "once recovered, it is no longer flagged");
    assert.equal((await applyCheckoutPayment(lost, undefined, "RECONCILE", w.deps)).outcome, "ALREADY_GRANTED");
    assert.equal((await applyCheckoutPayment(lost, undefined, "WEBHOOK", w.deps)).outcome, "ALREADY_GRANTED",
      "the webhook arriving after a reconcile recovery is a no-op");
    assert.equal(w.db.subs.get("u1")!.currentPeriodEnd!.getTime(), NOW.getTime() + PAID_PERIOD_MS);

    // A legacy grant recorded only in lastPaymentRef counts as granted too.
    const w2 = world();
    w2.addUser("u9", { tier: "VIP", status: "ACTIVE", lastPaymentRef: "T123456789" });
    const legacy = await planReconciliation([{ reference: "T123456789", status: "success", metadata: { userId: "u9" } }], w2.deps.db);
    assert.equal(legacy[0].action, "NONE", "a pre-ledger grant is recognised");
  }

  // -------------------------------------------------------------------------
  // 8. CHECKOUT START vs. A GRANT. Starting a checkout must never cost access
  //    a payment has just granted, nor shorten or remove access already held,
  //    in any interleaving. The real recordCheckoutStart (what the initialize
  //    route runs) is held between its statements while a real grant commits.
  // -------------------------------------------------------------------------
  const DAY10 = new Date(NOW.getTime() + 10 * DAY);
  const startStates: [string, Partial<Sub>, number][] = [
    // label, row before, the period end the grant must extend from
    ["a new customer", {}, NOW.getTime()],
    ["a lapsed VIP", { tier: "VIP", status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() - DAY) }, NOW.getTime()],
    ["an active VIP renewing early", { tier: "VIP", status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: DAY10 }, DAY10.getTime()],
  ];
  for (const [label, before, extendsFrom] of startStates) {
    // 0 = the grant commits before the checkout start begins; N = the checkout
    // start is paused right after its Nth subscription statement.
    for (const pauseAfter of [0, 1, 2, 3]) {
      const w = world();
      w.addUser("u1", before);
      const paying = w.startCheckout("u1", "VIP"); // the checkout being paid for
      w.paystackSays(paying, "u1", "VIP");
      const next = newCheckoutReference("VIP"); // a second checkout starting now

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const startDb = pauseAfter === 0 ? w.db : pausedAfter(w.db, pauseAfter, gate);
      if (pauseAfter === 0) {
        assert.equal((await applyCheckoutPayment(paying, undefined, "WEBHOOK", w.deps)).outcome, "GRANTED");
      }
      const starting = recordCheckoutStart(startDb as any, "u1", "VIP", next, NOW);
      if (pauseAfter > 0) {
        // Let the checkout start reach its pause point (or finish, if it has
        // fewer statements than that), then commit the grant inside the gap.
        for (let i = 0; i < 20; i++) await tick();
        const granted = await applyCheckoutPayment(paying, undefined, "WEBHOOK", w.deps);
        assert.equal(granted.outcome, "GRANTED", `${label}, pause ${pauseAfter}: the payment is granted`);
        release();
      }
      await starting;

      const sub = w.db.subs.get("u1")!;
      const where = `${label}, checkout start paused after statement ${pauseAfter}`;
      assert.equal(sub.status, "ACTIVE", `${where}: the checkout start must not overwrite the grant`);
      assert.equal(sub.tier, "VIP", `${where}: the paid tier survives`);
      assert.equal(sub.currentPeriodEnd?.getTime(), extendsFrom + PAID_PERIOD_MS, `${where}: the granted period is intact`);
      assert.equal(sub.lastPaymentRef, paying, `${where}: the grant is recorded`);
      assert.equal(sub.paystackRef, next, `${where}: the new checkout is still recorded`);
    }
  }

  // The other order: the checkout start lands between the grant's read and
  // its write. The grant's compare-and-set notices, re-reads, and grants the
  // payment as superseded — without disturbing the new checkout.
  {
    const w = world();
    w.addUser("u1");
    const paying = w.startCheckout("u1", "VIP");
    w.paystackSays(paying, "u1", "VIP");
    w.slow.set(paying, 40); // the grant has read the row and is waiting on Paystack
    const granting = applyCheckoutPayment(paying, undefined, "WEBHOOK", w.deps);
    for (let i = 0; i < 5; i++) await tick();
    const next = newCheckoutReference("PREMIUM");
    await recordCheckoutStart(w.db as any, "u1", "PREMIUM", next, NOW);
    assert.equal((await granting).outcome, "GRANTED", "a grant racing a checkout start is still granted");
    const sub = w.db.subs.get("u1")!;
    assert.equal(sub.status, "ACTIVE");
    assert.equal(sub.tier, "VIP", "for the tier that was paid, not the one being started");
    assert.equal(sub.currentPeriodEnd!.getTime(), NOW.getTime() + PAID_PERIOD_MS);
    assert.equal(sub.paystackRef, next, "the new checkout stays in flight");
  }

  // Existing checkout-start behaviour, unchanged, on its own.
  {
    const w = world();
    const ref = () => newCheckoutReference("PREMIUM");
    const cases: [string, Partial<Sub> | null, Partial<Sub>][] = [
      ["no row yet", null, { tier: "PREMIUM", status: "PENDING" }],
      ["a free account", { tier: "FREE", status: "PENDING" }, { tier: "PREMIUM", status: "PENDING" }],
      ["an ACTIVE row on a free tier", { tier: "FREE", status: "ACTIVE" }, { tier: "PREMIUM", status: "PENDING" }],
      ["an expired paid period", { tier: "VIP", status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() - 1) }, { tier: "PREMIUM", status: "PENDING" }],
      ["a cancelled row", { tier: "VIP", status: "CANCELED" }, { tier: "PREMIUM", status: "PENDING" }],
      ["live paid access", { tier: "VIP", status: "ACTIVE", currentPeriodEnd: DAY10 }, { tier: "VIP", status: "ACTIVE", currentPeriodEnd: DAY10 }],
      ["comped access (no expiry)", { tier: "PREMIUM", status: "ACTIVE", currentPeriodEnd: null }, { tier: "PREMIUM", status: "ACTIVE", currentPeriodEnd: null }],
    ];
    for (const [i, [label, before, after]] of cases.entries()) {
      const userId = `s${i}`;
      if (before) w.addUser(userId, before);
      const reference = ref();
      await recordCheckoutStart(w.db as any, userId, "PREMIUM", reference, NOW);
      const sub = w.db.subs.get(userId)!;
      for (const [key, value] of Object.entries(after)) {
        assert(same((sub as any)[key] ?? null, value ?? null), `${label}: ${key} should be ${String(value)}, got ${String((sub as any)[key])}`);
      }
      assert.equal(sub.paystackRef, reference, `${label}: the checkout reference is recorded`);
    }

    // Two checkout starts at once for an account with no row: one row, and it
    // holds one of the two references.
    const a = ref();
    const b = ref();
    await Promise.all([
      recordCheckoutStart(w.db as any, "double", "PREMIUM", a, NOW),
      recordCheckoutStart(w.db as any, "double", "PREMIUM", b, NOW),
    ]);
    assert([a, b].includes(w.db.subs.get("double")!.paystackRef!), "a double click leaves one row with one of its references");
  }

  // -------------------------------------------------------------------------
  // 9. Webhook signatures.
  // -------------------------------------------------------------------------
  const body = JSON.stringify({ event: "charge.success", data: { reference: "bg_VIP_" + "a".repeat(32) } });
  const good = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(body).digest("hex");
  assert.equal(verifyPaystackSignature(body, good), true, "a correctly signed body is accepted");
  assert.equal(verifyPaystackSignature(body, null), false, "a missing signature is refused");
  assert.equal(verifyPaystackSignature(body, "deadbeef"), false, "a wrong signature is refused");
  assert.equal(verifyPaystackSignature(body + " ", good), false, "a tampered body is refused");
  const wrongKey = crypto.createHmac("sha512", "sk_test_other").update(body).digest("hex");
  assert.equal(verifyPaystackSignature(body, wrongKey), false, "a body signed with another key is refused");

  // -------------------------------------------------------------------------
  // 10. The one-time fallback's initialisation, read from source: no plan (so
  //    Paystack does not narrow channels to recurring-capable ones), the
  //    server's price, our reference, and a way back for a payer who cancels.
  // -------------------------------------------------------------------------
  const initialize = readFileSync("src/app/api/subscription/initialize/route.ts", "utf8");
  const call = initialize.slice(initialize.indexOf("initializeTransaction({"), initialize.indexOf("} catch (error)"));
  assert(!/^\s*plan\s*:/m.test(call), "the one-time fallback sends no plan");
  assert(!/channels\s*:/.test(call), "channels are left to the Paystack account, not narrowed in code");
  assert(/amountKobo:\s*koboFor\(tier\)/.test(call), "the amount is the server's price for the tier");
  assert(/reference,/.test(call), "the checkout uses our tier-carrying reference");
  assert(/cancel_action:.*\/pricing\?checkout=cancelled/.test(call), "a cancelled checkout returns to the plans");
  assert(/userId: session\.user\.id/.test(call) && /tier: parsed\.data\.tier/.test(call), "verification metadata is set");
  assert.equal(classifyPaymentAttempt({ status: "abandoned" }), "ABANDONED");

  console.log(
    "Payment reliability checks passed: VIP/Premium grant one 30-day period at 2,000,000/5,000,000 kobo; " +
      "duplicate and concurrent webhook/callback grant once; amount, currency, customer and tier mismatches, " +
      "abandoned, fraud-blocked, declined and pending payments grant nothing; unknown references fail closed; " +
      "a superseded checkout paid late is granted without disturbing the newer one and can never re-grant; " +
      "concurrent payments each buy a period; a checkout start never overwrites a concurrent grant or shortens existing access; reconciliation flags paid-without-access, ignores external " +
      "transactions, recovers through the verified path and never double-grants; signatures are enforced; " +
      "the one-time initialisation sends no plan and gives a cancel path.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
