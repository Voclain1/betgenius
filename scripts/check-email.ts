/** Offline checks for subscriber email: tokens, rendering, and who gets what. No network or database. */
import assert from "node:assert/strict";

process.env.NEXTAUTH_SECRET ||= "check-email-secret";

async function main() {
  const { unsubscribeToken, readUnsubscribeToken } = await import("../src/lib/mail/unsubscribe");
  const t = await import("../src/lib/mail/templates");
  const { problemsToEmail, problemFor, inDailyPicksWindow, PROBLEM_DELAY_MS } = await import("../src/lib/mail/rules");
  const { retryDelayMs } = await import("../src/lib/mail/outbox");

  // --- Unsubscribe tokens: round-trip, and nothing else verifies.
  const token = unsubscribeToken("user_1", "dailyPicks");
  assert.deepEqual(readUnsubscribeToken(token), { userId: "user_1", kind: "dailyPicks" });
  const [payload, sig] = token.split(".");
  const forged = `${Buffer.from("user_2:dailyPicks").toString("base64url")}.${sig}`;
  assert.equal(readUnsubscribeToken(forged), null, "another user's id with this signature must not verify");
  assert.equal(readUnsubscribeToken(`${payload}.${sig.slice(0, -1)}x`), null, "a tampered signature must not verify");
  assert.equal(readUnsubscribeToken(`${Buffer.from("user_1:everything").toString("base64url")}.${sig}`), null);
  assert.equal(readUnsubscribeToken(""), null);
  assert.equal(readUnsubscribeToken("junk"), null);

  // --- Announcements are plain text: nothing typed into them becomes markup.
  const evil = t.announcementEmail({ subject: "Hi <b>", body: "<script>alert(1)</script>\n\nSecond <a href=x>", unsubscribeUrl: "https://x/u?t=1" });
  assert.doesNotMatch(evil.html, /<script>|<a href=x>|<b>/);
  assert.match(evil.html, /&lt;script&gt;/);
  assert.match(evil.html, /Unsubscribe/);
  assert.equal(evil.subject, "Hi <b>", "subject is a header, not HTML");
  assert.equal((t.paragraphsHtml("one\n\ntwo\nthree").match(/<p /g) ?? []).length, 2);
  assert.match(t.paragraphsHtml("two\nthree"), /two<br>three/);

  // --- Account emails carry no unsubscribe link; optional ones do.
  const receipt = t.receiptEmail({ tier: "VIP", amountNgn: 20000, reference: "bg_VIP_x", paidAt: new Date("2026-10-10T10:00:00Z"), accessUntil: new Date("2026-11-09T10:00:00Z") });
  assert.match(receipt.text, /₦20,000/);
  assert.match(receipt.text, /9 November 2026/);
  assert.match(receipt.text, /bg_VIP_x/);
  assert.doesNotMatch(receipt.html, /Unsubscribe/);
  const picks = t.dailyPicksEmail({
    tier: "VIP",
    dateLabel: "Sat 10 Oct",
    feedHref: "https://x/predictions/vip",
    unsubscribeUrl: "https://x/email/unsubscribe?t=abc",
    picks: [{ home: "Arsenal", away: "Chelsea", league: "Premier League", kickoff: new Date("2026-10-10T14:00:00Z"), market: "Match winner", pick: "Arsenal", odds: 1.85, href: "https://x/m" }],
  });
  assert.match(picks.subject, /1 match$/);
  assert.match(picks.text, /15:00/, "kickoff shown in Lagos time (UTC+1)");
  assert.match(picks.text, /@ 1\.85/);
  assert.match(picks.html, /Unsubscribe/);
  for (const problem of ["ABANDONED", "ISSUER_DECLINE", "INSUFFICIENT_FUNDS", "FRAUD_BLOCK", "GATEWAY_FAILURE", "TIMED_OUT", "UNKNOWN_FAILURE"] as const) {
    const e = t.paymentProblemEmail({ tier: "VIP", problem, reference: "bg_VIP_ref" });
    assert.match(e.text, /bg_VIP_ref/);
    assert.match(e.text, /\/pricing/);
  }

  // Replies are only invited when a support inbox exists to receive them.
  delete process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  assert.match(t.paymentProblemEmail({ tier: "VIP", problem: "FRAUD_BLOCK", reference: "r" }).text, /contact us at .*\/contact/);
  assert.doesNotMatch(t.paymentProblemEmail({ tier: "VIP", problem: "FRAUD_BLOCK", reference: "r" }).text, /reply to this email/);
  process.env.NEXT_PUBLIC_CONTACT_EMAIL = "help@example.com";
  assert.match(t.paymentProblemEmail({ tier: "VIP", problem: "FRAUD_BLOCK", reference: "r" }).text, /reply to this email/);
  delete process.env.NEXT_PUBLIC_CONTACT_EMAIL;

  // --- Payment problems: who gets one.
  const now = new Date("2026-10-10T12:00:00Z");
  const ref = (n: number) => `bg_VIP_${String(n).padStart(32, "0")}`;
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const attempt = (n: number, userId: string | null, category: string, minAgo: number, tier = "VIP") => ({ reference: ref(n), userId, tier, category, occurredAt: ago(minAgo) });
  const chosen = problemsToEmail(
    [
      attempt(1, "a", "ISSUER_DECLINE", 120), // older problem for a…
      attempt(2, "a", "FRAUD_BLOCK", 60), //  …this newer one is the one that counts
      attempt(3, "b", "ABANDONED", 10), // too recent: they may still be paying
      attempt(4, "c", "ISSUER_DECLINE", 90), // c paid afterwards
      attempt(5, null, "ISSUER_DECLINE", 90), // no user
      attempt(6, "d", "PENDING", 90), // not a problem
      { reference: "T123456", userId: "e", tier: "VIP", category: "ISSUER_DECLINE", occurredAt: ago(90) }, // not our checkout
    ],
    [{ userId: "c", occurredAt: ago(80) }],
    now,
  );
  assert.deepEqual(chosen.map((c) => [c.userId, c.reference]), [["a", ref(2)]]);
  assert.ok(PROBLEM_DELAY_MS >= 30 * 60_000, "wait long enough for a retry before emailing");

  // An expired order (the real 10 Oct 2026 OPay case) is not a provider fault.
  assert.equal(problemFor({ category: "GATEWAY_FAILURE", gatewayResponse: "The order was closed due to timeout" }), "TIMED_OUT");
  assert.equal(problemFor({ category: "GATEWAY_FAILURE", gatewayResponse: "Transaction timed out" }), "TIMED_OUT");
  assert.equal(problemFor({ category: "GATEWAY_FAILURE", gatewayResponse: "System malfunction" }), "GATEWAY_FAILURE");
  assert.equal(problemFor({ category: "ISSUER_DECLINE", gatewayResponse: "Declined" }), "ISSUER_DECLINE");
  assert.doesNotMatch(t.paymentProblemEmail({ tier: "VIP", problem: "TIMED_OUT", reference: "r" }).text, /temporary problem/);

  // --- Daily picks window, Lagos time (UTC+1).
  assert.equal(inDailyPicksWindow(new Date("2026-10-10T07:59:00Z")), false, "08:59 Lagos");
  assert.equal(inDailyPicksWindow(new Date("2026-10-10T08:00:00Z")), true, "09:00 Lagos");
  assert.equal(inDailyPicksWindow(new Date("2026-10-10T18:59:00Z")), true, "19:59 Lagos");
  assert.equal(inDailyPicksWindow(new Date("2026-10-10T19:00:00Z")), false, "20:00 Lagos");

  assert.deepEqual([1, 2, 3, 4].map(retryDelayMs), [2, 4, 8, 16].map((m) => m * 60_000));

  console.log("Email checks passed: unsubscribe tokens, escaping, account vs optional emails, payment-problem rules, picks window, retries.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
