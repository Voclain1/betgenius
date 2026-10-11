/** Offline checks for the non-Paystack ways to pay (lib/payments). No network or database. */
import assert from "node:assert/strict";

process.env.NEXTAUTH_SECRET ||= "check-payments";

/** A minimal in-memory Prisma for grantPayment: atomic statements, serial transactions, rollback on throw. */
function fakeDb() {
  const subs = new Map<string, any>();
  const attempts = new Map<string, any>();
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => (v instanceof Date ? row[k]?.getTime?.() === v.getTime() : (row[k] ?? null) === (v ?? null)));
  const tx = {
    paymentAttempt: {
      upsert: async ({ where, create, update }: any) => {
        const row = attempts.get(where.reference);
        if (row) return Object.assign(row, update);
        const created = { entitlementGrantedAt: null, ...create };
        attempts.set(where.reference, created);
        return created;
      },
      updateMany: async ({ where, data }: any) => {
        const row = attempts.get(where.reference);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    subscription: {
      findUnique: async ({ where }: any) => (subs.has(where.userId) ? { ...subs.get(where.userId) } : null),
      create: async ({ data }: any) => {
        if (subs.has(data.userId)) throw Object.assign(new Error("unique"), { code: "P2002" });
        subs.set(data.userId, { ...data });
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        const row = subs.get(where.userId);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  let queue: Promise<unknown> = Promise.resolve();
  const db = {
    $transaction: (fn: (t: typeof tx) => Promise<any>) => {
      const run = queue.then(async () => {
        const subsBefore = new Map([...subs].map(([k, v]) => [k, { ...v }]));
        const attemptsBefore = new Map([...attempts].map(([k, v]) => [k, { ...v }]));
        try {
          return await fn(tx);
        } catch (error) {
          subs.clear();
          subsBefore.forEach((v, k) => subs.set(k, v));
          attempts.clear();
          attemptsBefore.forEach((v, k) => attempts.set(k, v));
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return { db: db as any, subs, attempts };
}

async function main() {
  const { grantPayment } = await import("../src/lib/payments/grant");
  const { enabledMethods, newManualCode, manualReference } = await import("../src/lib/payments/methods");
  const { flutterwaveMismatches, tierFromFlutterwaveReference, newFlutterwaveReference, validFlutterwaveSignature } = await import("../src/lib/payments/flutterwave");
  const { korapayMismatches, tierFromKorapayReference, newKorapayReference, validKorapaySignature } = await import("../src/lib/payments/korapay");
  const { attemptOrigin } = await import("../src/lib/paystack/attemptDiagnosis");
  const { PAID_PERIOD_MS } = await import("../src/lib/paystack/entitlement");

  // --- Which methods show: only fully configured ones.
  assert.deepEqual(enabledMethods({}), []);
  assert.deepEqual(enabledMethods({ PAYSTACK_SECRET_KEY: "x" }), ["PAYSTACK"]);
  assert.deepEqual(enabledMethods({ FLUTTERWAVE_SECRET_KEY: "x" }), [], "no webhook secret, no Flutterwave");
  assert.deepEqual(enabledMethods({ KORAPAY_SECRET_KEY: "sk" }), ["KORAPAY"]);
  assert.deepEqual(enabledMethods({ BANK_TRANSFER_BANK_NAME: "OPay", BANK_TRANSFER_ACCOUNT_NUMBER: "1" }), [], "half a bank account is not a bank account");
  assert.deepEqual(
    enabledMethods({ PAYSTACK_SECRET_KEY: "x", KORAPAY_SECRET_KEY: "k", FLUTTERWAVE_SECRET_KEY: "x", FLUTTERWAVE_SECRET_HASH: "h", BANK_TRANSFER_BANK_NAME: "OPay", BANK_TRANSFER_ACCOUNT_NUMBER: "1", BANK_TRANSFER_ACCOUNT_NAME: "BetGenius", USDT_WALLET_ADDRESS: "T..." }),
    ["PAYSTACK", "KORAPAY", "FLUTTERWAVE", "BANK", "USDT"],
  );

  // --- References: ours, recognised by the admin view, tier recoverable.
  const code = newManualCode();
  assert.match(code, /^BG-[A-HJ-KMNP-Z2-9]{6}$/, "no 0/O/1/I/L to misread");
  assert.equal(attemptOrigin(manualReference(code), "u1"), "CHECKOUT");
  const fwRef = newFlutterwaveReference("PREMIUM");
  assert.equal(tierFromFlutterwaveReference(fwRef), "PREMIUM");
  assert.equal(attemptOrigin(fwRef, "u1"), "CHECKOUT");
  assert.equal(tierFromFlutterwaveReference("bg_VIP_" + "0".repeat(32)), null);

  // --- Flutterwave: every check must pass.
  const good = { status: "successful", tx_ref: fwRef, currency: "NGN", amount: 50000, customer: { email: "A@x.com" } };
  assert.deepEqual(flutterwaveMismatches(good, { reference: fwRef, email: "a@x.com" }), []);
  assert.deepEqual(flutterwaveMismatches({ ...good, status: "failed" }, { reference: fwRef, email: "a@x.com" }), ["NOT_SUCCESSFUL"]);
  assert.deepEqual(flutterwaveMismatches({ ...good, amount: 20000 }, { reference: fwRef, email: "a@x.com" }), ["AMOUNT_MISMATCH"], "a VIP price cannot buy Premium");
  assert.deepEqual(flutterwaveMismatches({ ...good, currency: "USD" }, { reference: fwRef, email: "a@x.com" }), ["CURRENCY_MISMATCH"]);
  assert.deepEqual(flutterwaveMismatches(good, { reference: fwRef, email: "b@x.com" }), ["CUSTOMER_MISMATCH"]);
  assert.deepEqual(flutterwaveMismatches({ ...good, tx_ref: "fw_PREMIUM_x" }, { reference: fwRef, email: "a@x.com" }), ["REFERENCE_MISMATCH"]);

  // --- Korapay: reference, verification rules, webhook signature.
  const kpRef = newKorapayReference("VIP");
  assert.equal(tierFromKorapayReference(kpRef), "VIP");
  assert.equal(attemptOrigin(kpRef, "u1"), "CHECKOUT");
  assert.equal(tierFromKorapayReference(fwRef), null);
  const { PLAN_PRICING } = await import("../src/lib/pricing");
  const kpGood = { status: "success", reference: kpRef, currency: "NGN", amount: PLAN_PRICING.VIP.ngn };
  assert.deepEqual(korapayMismatches(kpGood, { reference: kpRef }), []);
  assert.deepEqual(korapayMismatches({ ...kpGood, amount: String(PLAN_PRICING.VIP.ngn) }, { reference: kpRef }), [], "amount may arrive as a string");
  assert.deepEqual(korapayMismatches({ ...kpGood, status: "processing" }, { reference: kpRef }), ["NOT_SUCCESSFUL"]);
  assert.deepEqual(korapayMismatches({ ...kpGood, amount: PLAN_PRICING.VIP.ngn * 100 }, { reference: kpRef }), ["AMOUNT_MISMATCH"], "naira, not kobo");
  assert.deepEqual(korapayMismatches({ ...kpGood, amount: PLAN_PRICING.VIP.ngn - 1 }, { reference: kpRef }), ["AMOUNT_MISMATCH"]);
  assert.deepEqual(korapayMismatches({ ...kpGood, currency: "USD" }, { reference: kpRef }), ["CURRENCY_MISMATCH"]);
  assert.deepEqual(korapayMismatches({ ...kpGood, reference: newKorapayReference("VIP") }, { reference: kpRef }), ["REFERENCE_MISMATCH"]);
  {
    const crypto = await import("node:crypto");
    const body = JSON.stringify({ event: "charge.success", data: { reference: kpRef, status: "success" } });
    const sign = (s: string) => crypto.createHmac("sha256", "sk_live").update(s).digest("hex");
    assert.equal(validKorapaySignature(body, sign(JSON.stringify({ reference: kpRef, status: "success" })), "sk_live"), true, "the data object, as Korapay documents");
    assert.equal(validKorapaySignature(body, sign(body), "sk_live"), true, "or the whole body");
    assert.equal(validKorapaySignature(body, sign(body), "sk_other"), false);
    assert.equal(validKorapaySignature(body, null, "sk_live"), false);
    assert.equal(validKorapaySignature(body, sign(body), ""), false, "no key configured, nothing is trusted");
    assert.equal(validKorapaySignature("not json", sign("not json"), "sk_live"), false);
  }

  // --- Webhook secret.
  process.env.FLUTTERWAVE_SECRET_HASH = "s3cret";
  assert.equal(validFlutterwaveSignature("s3cret"), true);
  assert.equal(validFlutterwaveSignature("s3cre"), false);
  assert.equal(validFlutterwaveSignature(null), false);
  delete process.env.FLUTTERWAVE_SECRET_HASH;
  assert.equal(validFlutterwaveSignature("anything"), false, "no secret configured, nothing is trusted");

  // --- Granting: exactly once, extends, never loses a month.
  const now = new Date("2026-10-11T12:00:00Z");
  const base = { provider: "BANK" as const, tier: "VIP" as const, amountMinor: 2_000_000, currency: "NGN" as const, channel: "bank_transfer_direct", occurredAt: now, source: "ADMIN" };
  {
    const { db, subs, attempts } = fakeDb();
    const r1 = await grantPayment({ ...base, reference: "manual_BG-AAAAAA", userId: "u1" }, db, now);
    assert.equal(r1.outcome, "GRANTED", "a user with no subscription row gets one");
    assert.equal(subs.get("u1").currentPeriodEnd.getTime(), now.getTime() + PAID_PERIOD_MS);
    assert.equal(subs.get("u1").status, "ACTIVE");
    const r2 = await grantPayment({ ...base, reference: "manual_BG-AAAAAA", userId: "u1" }, db, now);
    assert.equal(r2.outcome, "ALREADY_GRANTED", "approving twice buys one month");
    assert.equal(subs.get("u1").currentPeriodEnd.getTime(), now.getTime() + PAID_PERIOD_MS);
    assert.ok(attempts.get("manual_BG-AAAAAA").entitlementGrantedAt, "the ledger row is what sends the receipt");
  }
  {
    const { db, subs } = fakeDb();
    const end = new Date(now.getTime() + 10 * 86_400_000);
    subs.set("u2", { userId: "u2", tier: "VIP", status: "ACTIVE", currentPeriodStart: new Date(now.getTime() - 20 * 86_400_000), currentPeriodEnd: end });
    await grantPayment({ ...base, reference: "manual_BG-BBBBBB", userId: "u2" }, db, now);
    assert.equal(subs.get("u2").currentPeriodEnd.getTime(), end.getTime() + PAID_PERIOD_MS, "renewing early adds on top of the days left");
  }
  {
    const { db, subs } = fakeDb();
    subs.set("u3", { userId: "u3", tier: "FREE", status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null });
    // Two different payments at once (webhook + admin): both count.
    const [a, b] = await Promise.all([
      grantPayment({ ...base, reference: "manual_BG-CCCCCC", userId: "u3" }, db, now),
      grantPayment({ ...base, provider: "FLUTTERWAVE", reference: fwRef, userId: "u3" }, db, now),
    ]);
    assert.deepEqual([a.outcome, b.outcome], ["GRANTED", "GRANTED"]);
    assert.equal(subs.get("u3").currentPeriodEnd.getTime(), now.getTime() + 2 * PAID_PERIOD_MS, "two payments, two months");
  }

  console.log("Payment checks passed: method switches, references, Korapay and Flutterwave verification rules and webhook signatures, exactly-once grants that extend and never lose a month.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
