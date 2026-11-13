/**
 * Paid reliability, subscriber experience, performance and access, proved
 * without a database or network.
 *
 *   1. Day classifier and its precedence; run-gap measurement.
 *   2. Alerts: failure statuses only; silent pass / shadow; opt-in; once per day.
 *   3. Generation failure policy: a provider outage spends no retry.
 *   4. api-football paid reserve: ceilings, scope across awaits, the gate.
 *   5. Performance: pending excluded, voids, win rate, return thresholds, entry
 *      vs closing prices never mixed, markets, recent order, consistency with
 *      the site's computeStat.
 *   6. Pick status and selection reason (no EV, no promise, no "AI").
 *   7. Card price: recorded entry first, derived never, post-kickoff never.
 *   8. Badge input stripped of internal assessment fields.
 *   9. Row-level access: paid-only picks need paid access through any feed;
 *      lapsed subscriptions see nothing; ordinary rows follow their feed.
 *  10. Kickoff guard on paid admission and auto-publication.
 *  11. Wiring and data contracts (source checks).
 *
 * Run: npx tsx scripts/check-paid-subscriber.ts
 */
export {};

const react = require("react");
if (typeof react.cache !== "function") react.cache = (fn: unknown) => fn;

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) passed++;
  else failures.push(`${label}${got === undefined ? "" : `\n      got: ${JSON.stringify(got)?.slice(0, 400)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), got);
type Any = any;
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

function stub(request: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(request);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } } as unknown as NodeJS.Module;
}
let used = 0;
const locks = new Set<string>();
const sentMail: string[] = [];
stub("../src/lib/prisma", {
  prisma: {
    apiUsage: { aggregate: async () => ({ _sum: { count: used } }) },
    appLock: {
      create: async ({ data }: Any) => { if (locks.has(data.key)) throw new Error("unique"); locks.add(data.key); return data; },
      delete: async ({ where }: Any) => { locks.delete(where.key); },
    },
  },
});
stub("../src/lib/email", { sendEmail: async (m: Any) => { sentMail.push(m.subject); return { delivered: true }; } });

const ops = require("../src/lib/paidOps");
const alert = require("../src/lib/paidOpsAlert");
const policy = require("../src/lib/generation/failurePolicy");
const usage = require("../src/lib/football/usage");
const perf = require("../src/lib/paidPerformance");
const feed = require("../src/lib/paidFeedData");
const { badgeConfirmation } = require("../src/components/PredictionCard");
const { rowViewable } = require("../src/lib/lockedPrediction");
const { canViewCategory } = require("../src/lib/access");
const { resolveSubscription } = require("../src/lib/entitlement");
const { computeStat } = require("../src/lib/trackRecord");
const curation = require("../src/lib/geniusCuration");
const overlay = require("../src/lib/vipPremiumOverlay");
const { MAX_GENERATION_ATTEMPTS } = require("../src/lib/generation/selector");

const NOW = new Date("2026-11-14T12:00:00.000Z");
const H = 3_600_000;

async function main() {
  // ── 1. Classifier ───────────────────────────────────────────────────────
  const day = (o: Any = {}) => ({ day: "2026-11-14", discovered: 30, covered: 30, failed: 0, paidScope: 10, paidScopePriced: 9, attempts: 6, attemptErrors: 0, promoted: 2, published: 2, maxRunGapMinutes: 16, vipPicks: 4, ...o });
  eq("classify: a healthy day is OK", ops.classifyPaidDay(day()).status, "OK");
  eq("classify: few picks with everything running is LOW_OPPORTUNITY", ops.classifyPaidDay(day({ vipPicks: 1 })).status, "LOW_OPPORTUNITY");
  eq("classify: under 3 fixtures discovered is MISSING_FIXTURES", ops.classifyPaidDay(day({ discovered: 2, covered: 2, vipPicks: 0 })).status, "MISSING_FIXTURES");
  eq("classify: over 30% of fixtures failed is GENERATION_FAILURE", ops.classifyPaidDay(day({ failed: 12, vipPicks: 0 })).status, "GENERATION_FAILURE");
  eq("classify: 2+ paid-pass generation errors is GENERATION_FAILURE", ops.classifyPaidDay(day({ attemptErrors: 2 })).status, "GENERATION_FAILURE");
  eq("classify: paid scope mostly unpriced is PRICING_FAILURE", ops.classifyPaidDay(day({ paidScopePriced: 3, vipPicks: 0 })).status, "PRICING_FAILURE");
  eq("classify: a promoted pick never published is PUBLICATION_FAILURE", ops.classifyPaidDay(day({ promoted: 3, published: 2 })).status, "PUBLICATION_FAILURE");
  eq("classify: the pass silent for 3h is PUBLICATION_FAILURE", ops.classifyPaidDay(day({ maxRunGapMinutes: 180 })).status, "PUBLICATION_FAILURE");
  eq("classify: a failure is reported before low opportunity", ops.classifyPaidDay(day({ vipPicks: 0, paidScopePriced: 1 })).status, "PRICING_FAILURE");
  check("classify: every failure reason is listed", ops.classifyPaidDay(day({ failed: 12, paidScopePriced: 1, promoted: 3, published: 1 })).reasons.length === 3);
  eq("gap: runs every 15 minutes leave a 15-minute gap", ops.maxGapMinutes([0, 15, 30, 45, 60].map((m) => new Date(NOW.getTime() + m * 60_000)), NOW, new Date(NOW.getTime() + 60 * 60_000)), 15);
  eq("gap: the window's edges count (no run for the first 2h)", ops.maxGapMinutes([new Date(NOW.getTime() + 2 * H)], NOW, new Date(NOW.getTime() + 3 * H)), 120);

  // ── 2. Alerts ───────────────────────────────────────────────────────────
  const snap = (days: Any[], o: Any = {}) => ({ days, settlementBacklog: { pendingOver6h: 0, manualOnly: 0, oldest: null }, shadow: { last24h: 5, lastAt: null, lastSummary: null, fallbacks: {}, modes: {} }, paidPassLast24h: { runs: 90, failedRuns: 0, lastAt: null }, ...o });
  const d = (status: string) => ({ ...day(), status, reasons: [`${status}: x`], premiumPicks: 0, shadowRuns: 1 });
  eq("alert: a low-opportunity day never alerts", alert.paidOpsAlertsDue(snap([d("OK"), d("LOW_OPPORTUNITY")]), NOW, "shadow"), []);
  eq("alert: a pricing failure alerts", alert.paidOpsAlertsDue(snap([d("OK"), d("PRICING_FAILURE")]), NOW, "shadow").map((a: Any) => a.cause), ["PRICING_FAILURE"]);
  eq("alert: only yesterday and today are judged", alert.paidOpsAlertsDue(snap([d("PRICING_FAILURE"), d("OK"), d("OK")]), NOW, "shadow"), []);
  eq("alert: a silent paid pass alerts", alert.paidOpsAlertsDue(snap([d("OK")], { paidPassLast24h: { runs: 0, failedRuns: 0, lastAt: null } }), NOW, "shadow").map((a: Any) => a.cause), ["PAID_PASS_SILENT"]);
  eq("alert: a silent shadow log alerts in shadow mode", alert.paidOpsAlertsDue(snap([d("OK")], { shadow: { last24h: 0 } }), NOW, "shadow").map((a: Any) => a.cause), ["SHADOW_LOG_SILENT"]);
  eq("alert: ...but not in current mode", alert.paidOpsAlertsDue(snap([d("OK")], { shadow: { last24h: 0 } }), NOW, "current"), []);
  delete process.env.PAID_OPS_ALERT_EMAIL;
  eq("alert: nothing is sent without PAID_OPS_ALERT_EMAIL", (await alert.sendPaidOpsAlerts(NOW)).skipped, "PAID_OPS_ALERT_EMAIL not set");
  check("alert: once per day and cause (AppLock claim before send)", /appLock[\s\S]{0,40}\.create\(/.test(read("src/lib/paidOpsAlert.ts")) && /if \(!claimed\) continue/.test(read("src/lib/paidOpsAlert.ts")));
  check("alert: the settle route runs the check", /await sendPaidOpsAlerts\(\)/.test(read("src/app/api/admin/settle/route.ts")));

  // ── 3. Failure policy ───────────────────────────────────────────────────
  check("outage: recognised by error name and by message", policy.isProviderOutage({ name: "AllProvidersFailedError" }) && policy.isProviderOutage(new Error("Every AI provider failed: gemini (x)")) && !policy.isProviderOutage(new Error("timeout")));
  const o = policy.ledgerFailureUpdate(2, true, NOW);
  eq("outage: spends no retry, stays FAILED, retried in 60 minutes", [o.status, o.attempts, o.nextAttemptAt.getTime() - NOW.getTime()], ["FAILED", 2, 60 * 60_000]);
  eq("normal failure: counts, and dead-letters at the limit as before", [policy.ledgerFailureUpdate(0, false, NOW).status, policy.ledgerFailureUpdate(MAX_GENERATION_ATTEMPTS - 1, false, NOW).status], ["FAILED", "ABANDONED"]);
  const worker = read("src/lib/generation/worker.ts");
  check("outage: the run stops at the first outage", /if \(outage\) \{[\s\S]{0,200}break;/.test(worker));

  // ── 4. Paid reserve ─────────────────────────────────────────────────────
  eq("reserve: 300 by default", usage.PAID_PRIORITY_RESERVE, 300);
  eq("reserve: the paid pass may spend to limit − reserve; others stop 300 earlier", usage.budgetCeiling(true) - usage.budgetCeiling(false), 300);
  used = usage.budgetCeiling(false) + 1;
  check("reserve: past the ordinary ceiling an ordinary call is refused", !(await usage.hasBudget()));
  check("reserve: ...and a paid-pass call is allowed", await usage.withPaidPriority(async () => { await new Promise((r) => setTimeout(r, 1)); return usage.hasBudget(); }));
  check("reserve: the priority scope ends with the call", !usage.inPaidPriority());
  used = usage.budgetCeiling(true);
  check("reserve: at the paid ceiling even the paid pass stops", !(await usage.withPaidPriority(() => usage.hasBudget())));
  check("reserve: the paid pass runs inside withPaidPriority", /return withPaidPriority\(\(\) => runVipPremiumGenerationInner\(opts\)\)/.test(worker));
  check("reserve: ordinary and Goals headroom include the reserve", /const MIN_QUOTA_HEADROOM = BASE_QUOTA_HEADROOM \+ PAID_PRIORITY_RESERVE;/.test(worker));

  // ── 5. Performance ──────────────────────────────────────────────────────
  const row = (i: number, outcome: string, o: Any = {}) => ({ id: `r${String(i).padStart(3, "0")}`, kickoff: new Date(NOW.getTime() - (i + 1) * H), marketType: "DOUBLE_CHANCE", market: "Double Chance", pick: "A or Draw", homeTeam: "A", awayTeam: "B", leagueName: "L", outcome, entryPrice: null, closingPrice: 1.25, ...o });
  const rows = [...Array(24)].map((_, i) => row(i, "WON")).concat([...Array(8)].map((_, i) => row(100 + i, "LOST")), [row(200, "VOID"), row(201, "PENDING"), row(202, "PENDING", { kickoff: new Date(NOW.getTime() + H) })]);
  const p = perf.computePaidPerformance(rows, "2026-10-03", NOW);
  eq("perf: settled = won + lost + void; pending never counted", [p.record.total, p.record.won, p.record.lost, p.record.void, p.pending], [33, 24, 8, 1, 1]);
  eq("perf: win rate is won / (won + lost)", p.record.rate, 24 / 32);
  eq("perf: the record matches the site's computeStat", p.record, computeStat(rows.filter((r) => ["WON", "LOST", "VOID"].includes(r.outcome)).map((r) => r.outcome)));
  eq("perf: closing return over 32 priced decided picks, voids left out", [p.closing.priced, Number(p.closing.returnPct.toFixed(4))], [32, Number(((100 * (24 * 0.25 - 8)) / 32).toFixed(4))]);
  check("perf: a negative return is reported, not hidden", p.closing.returnPct < 0);
  eq("perf: no entry prices recorded → no entry return", [p.entry.priced, p.entry.returnPct], [0, null]);
  const few = perf.computePaidPerformance(rows.slice(0, 10), "2026-10-03", NOW);
  eq("perf: under 30 priced picks, no return figure", few.closing.returnPct, null);
  const mixed = perf.computePaidPerformance(rows.map((r: Any, i: number) => (i < 5 ? { ...r, entryPrice: 1.3 } : r)), "2026-10-03", NOW);
  eq("perf: entry and closing prices are counted separately", [mixed.entry.priced, mixed.closing.priced], [5, 32]);
  eq("perf: markets need 30 settled picks to be shown", [p.byMarket.length, perf.computePaidPerformance(rows.slice(0, 20), "x", NOW).byMarket.length], [1, 0]);
  check("perf: recent is newest first, settled only, at most 10", p.recent.length === 10 && p.recent.every((r: Any) => ["WON", "LOST", "VOID"].includes(r.outcome)) && p.recent[0].kickoff >= p.recent[1].kickoff);

  // ── 6. Status and reason ────────────────────────────────────────────────
  eq("status: before kickoff, during, after, settled", [
    perf.paidPickStatus(new Date(NOW.getTime() + H), "PENDING", NOW), perf.paidPickStatus(new Date(NOW.getTime() - H), "PENDING", NOW),
    perf.paidPickStatus(new Date(NOW.getTime() - 3 * H), "PENDING", NOW), perf.paidPickStatus(new Date(NOW.getTime() - 3 * H), "VOID", NOW),
  ], ["UPCOMING", "LIVE", "AWAITING_RESULT", "VOID"]);
  eq("status: a void says the stake is returned", perf.PAID_STATUS_LABELS.VOID, "Void · stake returned");
  const rDed = perf.paidSelectionReason({ marketConfirmation: { modelProbability: 78.4, marketProbability: 80.2 }, confidence: 78 }, "VIP");
  const rOrd = perf.paidSelectionReason({ marketConfirmation: null, confidence: 77 }, "PREMIUM");
  check("reason: a dedicated pick cites both independent reads", /78%/.test(rDed) && /80%/.test(rDed), rDed);
  check("reason: an ordinary pick cites the tier's published bar", /80% confidence bar/.test(rOrd), rOrd);
  eq("reason: the bars are the curation floors", [curation.VIP_CONFIDENCE_FLOOR, curation.PREMIUM_CONFIDENCE_FLOOR], [75, 80]);
  for (const t of [rDed, rOrd]) check(`reason: no value, profit, promise or "AI" wording — "${t.slice(0, 40)}…"`, !/\bAI\b|expected value|\bEV\b|profit|guarantee|value bet|edge/i.test(t));

  // ── 7. Card price ───────────────────────────────────────────────────────
  const quote = (fetchedAt: Date) => ({ fetchedAt, oddsJson: { bookmakerCount: 8, update: null, markets: [{ market: "Match Winner", selections: [{ value: "Home", best: 1.5, median: 1.45, bookmakers: 8, bestBookmaker: "B" }, { value: "Draw", best: 4, median: 3.9, bookmakers: 8, bestBookmaker: "B" }, { value: "Away", best: 7, median: 6.5, bookmakers: 8, bestBookmaker: "B" }] }] } });
  const card = (o: Any = {}) => ({ id: "c", kickoff: new Date(NOW.getTime() + 5 * H), outcome: "PENDING", publishedAt: new Date(NOW.getTime() - 20 * H), marketType: "MATCH_WINNER", selection: { value: "HOME" }, confidence: 78, marketConfirmation: null, homeTeamApiId: 1, awayTeamApiId: 2, ...o });
  const cur = feed.paidCardDetail(card(), quote(new Date(NOW.getTime() - H)), "VIP", NOW);
  eq("price: before kickoff, the latest median quote, labelled current", [cur.price.kind, cur.price.odds, cur.price.bookmakers], ["current", 1.45, 8]);
  const entry = feed.paidCardDetail(card({ marketConfirmation: { entryPrice: 1.38, entryBookmakers: 9, confirmedAt: "2026-11-13T10:00:00Z", modelProbability: 78, marketProbability: 79 } }), quote(new Date(NOW.getTime() - H)), "VIP", NOW);
  eq("price: a recorded entry price wins and is labelled as such", [entry.price.kind, entry.price.odds], ["entry", 1.38]);
  const closed = feed.paidCardDetail(card({ kickoff: new Date(NOW.getTime() - 3 * H), outcome: "WON" }), quote(new Date(NOW.getTime() - 4 * H)), "VIP", NOW);
  eq("price: after kickoff, the last pre-kickoff quote is the closing price", closed.price.kind, "closing");
  eq("price: a quote taken after kickoff is never shown", feed.paidCardDetail(card({ kickoff: new Date(NOW.getTime() - 3 * H) }), quote(new Date(NOW.getTime() - H)), "VIP", NOW).price, null);
  eq("price: a derived draw-no-bet price is never shown as a quote", feed.paidCardDetail(card({ marketType: "DRAW_NO_BET" }), quote(new Date(NOW.getTime() - H)), "VIP", NOW).price, null);
  check("contract: the card detail is plain JSON (strings and numbers, no Dates)", JSON.stringify(JSON.parse(JSON.stringify(entry))) === JSON.stringify(entry) && typeof entry.publishedAt === "string");

  // ── 8. Badge ────────────────────────────────────────────────────────────
  const stripped = badgeConfirmation({ modelProbability: 78, marketProbability: 80, gapPP: 2, bookmakers: 8, market: "Match Winner", value: "Home", quoteFetchedAt: null, valueAssessment: { expectedValue: 0.04 }, entryPrice: 1.3, calibrationVersion: "x", provider: "anthropic" } as Any);
  eq("badge: only the badge's own fields reach the client component", Object.keys(stripped).sort(), ["bookmakers", "gapPP", "market", "marketProbability", "modelProbability", "quoteFetchedAt", "value"]);
  check("badge: the card passes the stripped object", /<MarketConfirmedBadge confirmation=\{badgeConfirmation\(p\.marketConfirmation\)\} \/>/.test(read("src/components/PredictionCard.tsx")));

  // ── 9. Access ───────────────────────────────────────────────────────────
  const viewer = (tier: string | undefined, status: string | undefined) => (c: string) => canViewCategory(c, tier, status, undefined);
  const paidOnly = { provenance: "VIP_GENERATED", categories: [{ category: "VIP" }] };
  const premOnly = { provenance: "PREMIUM_GENERATED", categories: [{ category: "VIP" }, { category: "PREMIUM" }] };
  const ordinary = { provenance: "VIP_ROUTE_CONFIRMED", categories: [{ category: "FEATURED" }, { category: "VIP" }] };
  check("access: a paid-only pick requested through the public Today feed stays locked for an anonymous reader", rowViewable(paidOnly, true, viewer(undefined, undefined)) === false);
  check("access: ...and for a free account", rowViewable(paidOnly, true, viewer("FREE", "ACTIVE")) === false);
  check("access: ...and opens for an active VIP subscriber", rowViewable(paidOnly, true, viewer("VIP", "ACTIVE")) === true);
  check("access: a Premium pick opens for VIP too (it carries both tags)", rowViewable(premOnly, false, viewer("VIP", "ACTIVE")) === true);
  check("access: an ordinary pick follows its feed", rowViewable(ordinary, true, viewer(undefined, undefined)) === true && rowViewable(ordinary, false, viewer(undefined, undefined)) === false);
  check("access: a paid-only pick with no paid tag is staff only", rowViewable({ provenance: "VIP_GENERATED", categories: [{ category: "FEATURED" }] }, true, viewer("VIP", "ACTIVE")) === false && rowViewable({ provenance: "VIP_GENERATED", categories: [] }, true, (c: string) => canViewCategory(c, undefined, undefined, "ADMIN")) === true);
  const lapsed = resolveSubscription({ tier: "VIP", status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() - 60_000) }, NOW);
  check("access: a subscription past its period resolves as not active", lapsed.status !== "ACTIVE", lapsed);
  check("access: ...so it sees no VIP pick", rowViewable(paidOnly, true, viewer(lapsed.tier, lapsed.status)) === false && !canViewCategory("VIP", lapsed.tier, lapsed.status, undefined));
  const renewed = resolveSubscription({ tier: "VIP", status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() + 30 * 86_400_000) }, NOW);
  check("access: a renewed period is active again", renewed.status === "ACTIVE" && canViewCategory("VIP", renewed.tier, renewed.status, undefined));
  const api = read("src/app/api/predictions/route.ts");
  check("api: rows are gated by rowViewable", /rowViewable\(r, canViewCategory\(gateCategory/.test(api));
  check("api: non-paid feeds exclude paid-only rows, as the feed pages do", /category === "VIP" \|\| category === "PREMIUM" \? \{\} : NOT_PAID_ONLY/.test(api));
  check("api: responses are private and uncached", /"Cache-Control": "private, no-store"/.test(api) && /export const dynamic = "force-dynamic"/.test(api));
  check("api: locked rows still use the allowlist", /: lockedPredictionView\(r\)/.test(api));
  check("public: the track record's pick-level table excludes paid-only picks", /where: \{ \.\.\.where, \.\.\.NOT_PAID_ONLY \}/.test(read("src/lib/trackRecord.ts")));
  check("public: the homepage hero excludes paid-only picks", /\.\.\.NOT_PAID_ONLY,/.test(read("src/lib/heroSlides.ts")));
  const page = read("src/app/(public)/predictions/[category]/page.tsx");
  check("feed: subscriber detail is loaded only after the entitlement decision, only for viewers", /paidFeed && canView\s*\?\s*await Promise\.all\(\[loadPaidCardDetails\(rows, paidTier\), getPaidPerformance\(paidTier\)\]\)/.test(page));
  check("feed: the locked branch never receives paid detail", /paid: paidDetails\?\.get\(r\.id\) \?\? null \}/.test(page) && !/pick: "LOCKED",[\s\S]{0,300}paid:/.test(page));

  // ── 10. Kickoff guard ───────────────────────────────────────────────────
  eq("guard: one hour", overlay.PAID_MIN_PUBLISH_LEAD_MS, 60 * 60_000);
  const crow = (id: string, minutesToKickoff: number, tagged = false) => ({ id, leagueApiId: 39, confidence: 78, provenance: "VIP_ROUTE_CONFIRMED", marketType: "MATCH_WINNER", createdAt: NOW, kickoff: new Date(NOW.getTime() + minutesToKickoff * 60_000), fixtureApiId: null, homeTeamApiId: 100 + id.charCodeAt(0), awayTeamApiId: 900 + id.charCodeAt(0), categories: tagged ? ["FEATURED", "VIP"] : ["FEATURED"] });
  const timing = { now: NOW, minLeadMs: overlay.PAID_MIN_PUBLISH_LEAD_MS };
  const plan = curation.planCuration("VIP", [crow("a", 120), crow("b", 30), crow("c", -60), crow("d", 30, true)], new Set(), new Set(), undefined, undefined, timing);
  eq("guard: only the pick 2h out is newly admitted", plan.added, ["a"]);
  check("guard: a pick already in the feed stays as kickoff nears and passes", plan.selectedIds.includes("d") && !plan.removed.includes("d"));
  eq("guard: exclusions are counted", plan.kickoffExcluded, 2);
  eq("guard: without timing, the plan is unchanged", curation.planCuration("VIP", [crow("a", 120), crow("b", 30)], new Set(), new Set()).added.sort(), ["a", "b"]);
  check("guard: curation passes now and the lead", /\{ now, minLeadMs: pipeline\.PAID_MIN_PUBLISH_LEAD_MS \}/.test(read("src/lib/geniusCuration.ts")));
  check("guard: auto-publication refuses under the lead", /row\.kickoff\.getTime\(\) - now\.getTime\(\) < PAID_MIN_PUBLISH_LEAD_MS[\s\S]{0,120}TOO_CLOSE_TO_KICKOFF/.test(read("src/lib/vipPremiumPipeline.ts")));

  // ── 11. Copy ────────────────────────────────────────────────────────────
  for (const f of ["src/components/PaidPerformancePanel.tsx", "src/lib/paidPerformance.ts"]) {
    const text = read(f).split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    check(`copy: ${f} has no "AI" wording in what it renders`, !/["'`>][^"'`<]*\bAI\b/.test(text));
  }
  const panel = read("src/components/PaidPerformancePanel.tsx");
  check("copy: the panel says pending picks are not counted", /Picks still awaiting a result are not counted/.test(panel));
  check("copy: the panel says closing prices are not the price you got", /not necessarily the price you got/.test(panel));
  check("copy: the panel says confidence is not a guarantee", /not a guarantee/.test(panel));

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  if (failures.length) process.exit(1);
  console.log("Paid subscriber checks passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
