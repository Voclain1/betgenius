/**
 * End-to-end entitlement replay against a REAL test-mode Paystack transaction.
 *
 * This is deliberately not a fixture test. It calls Paystack's own
 * /transaction/verify for a reference that was really charged with an official
 * test card, and feeds the response Paystack actually returned into the real
 * validateVerifiedEntitlement. A fixture can drift from Paystack's live payload
 * shape; this cannot.
 *
 * Run: npx tsx scripts/e2e-paystack-live-verify.ts <reference> <userId> <email> <tier>
 */
export {};

async function main() {
  const [reference, userId, email, tier] = process.argv.slice(2);
  const { verifyTransaction } = await import("../src/lib/paystack/paystack");
  const { validateVerifiedEntitlement } = await import("../src/lib/paystack/entitlement");
  const { verifyPaystackSignature } = await import("../src/lib/paystack/verifySignature");
  const crypto = await import("node:crypto");

  const verified = await verifyTransaction(reference);
  console.log("Paystack /transaction/verify returned status:", verified.data.status);

  // The pending row the initialize route would have written for this checkout.
  const pending = { userId, userEmail: email, tier, paystackRef: reference, status: "PENDING" };

  const mismatches = validateVerifiedEntitlement(pending, verified.data);
  console.log(`\nentitlement on the REAL payload: ${mismatches.length === 0 ? "ACCEPTED" : "REJECTED"}`);
  for (const m of mismatches) console.log("   ", m);

  // Each guard must actually bite when the field is wrong, on this same real payload.
  console.log("\nnegative controls (real payload, one field corrupted):");
  const cases: [string, any, string][] = [
    ["amount off by 1 kobo", { ...verified.data, amount: verified.data.amount - 1 }, "AMOUNT_MISMATCH"],
    ["reference swapped", { ...verified.data, reference: "not-our-ref" }, "REFERENCE_MISMATCH"],
    ["different user in metadata", { ...verified.data, metadata: { ...verified.data.metadata, userId: "someone-else" } }, "USER_MISMATCH"],
    ["tier escalated in metadata", { ...verified.data, metadata: { ...verified.data.metadata, tier: "PREMIUM" } }, "TIER_MISMATCH"],
    ["customer email swapped", { ...verified.data, customer: { email: "attacker@example.com" } }, "CUSTOMER_MISMATCH"],
    ["currency swapped", { ...verified.data, currency: "USD" }, "CURRENCY_MISMATCH"],
    ["status not success", { ...verified.data, status: "failed" }, "TRANSACTION_NOT_SUCCESSFUL"],
  ];
  let failures = 0;
  for (const [label, payload, expected] of cases) {
    const got = validateVerifiedEntitlement(pending, payload).map((m) => m.code);
    const ok = got.includes(expected);
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} -> ${expected}${ok ? "" : `  (got ${got.join(",") || "none"})`}`);
  }

  // A replayed webhook must not upgrade twice: the row is no longer PENDING.
  const replay = validateVerifiedEntitlement({ ...pending, status: "ACTIVE" }, verified.data);
  const replayOk = replay.some((m) => m.code === "SUBSCRIPTION_NOT_PENDING");
  if (!replayOk) failures++;
  console.log(`  ${replayOk ? "PASS" : "FAIL"}  replayed webhook on an ACTIVE row -> SUBSCRIPTION_NOT_PENDING`);

  // Signature verification, with the real secret over a real body.
  console.log("\nsignature verification (real secret, real body):");
  const body = JSON.stringify({ event: "charge.success", data: verified.data });
  const good = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(body).digest("hex");
  const sigOk = verifyPaystackSignature(body, good);
  const sigBad = verifyPaystackSignature(body, good.replace(/.$/, (c) => (c === "a" ? "b" : "a")));
  const sigNone = verifyPaystackSignature(body, null);
  const tamper = verifyPaystackSignature(body.replace('"success"', '"failed"'), good);
  if (!sigOk || sigBad || sigNone || tamper) failures++;
  console.log(`  ${sigOk ? "PASS" : "FAIL"}  correct signature accepted`);
  console.log(`  ${!sigBad ? "PASS" : "FAIL"}  altered signature rejected`);
  console.log(`  ${!sigNone ? "PASS" : "FAIL"}  missing signature rejected`);
  console.log(`  ${!tamper ? "PASS" : "FAIL"}  tampered body rejected`);

  console.log(`\n${failures === 0 && mismatches.length === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures || mismatches.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
