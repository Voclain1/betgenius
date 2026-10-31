// Model comparison: Gemini (production) vs Claude Haiku 5.5, on settled fixtures.
//
// For each recent ordinary-generation job whose picks have settled, it rebuilds
// the EXACT production prompt from the evidence stored on the job (the digest
// the model saw before kickoff, src/lib/ai/context.ts) with the production
// builder (buildPredictionRequest), sends it to both models, and scores each
// answer the way generation would:
//   - parses as the expected JSON, every pick a valid market/selection;
//   - sentences the evidence checks would remove (H2H, knockout, managers),
//     and drafts the certainty / house-voice gates would reject;
//   - its top-confidence pick resolved against the real final score;
//   - tokens, estimated cost, latency.
//
// Read-only: it never writes. With REQUIRE_READ_ONLY=1 it refuses to start
// unless the database session is read-only (as the diagnose workflow sets up).
//
// Env: DATABASE_URL, GEMINI_API_KEY, ANTHROPIC_API_KEY
//      COMPARE_N (default 30), ANTHROPIC_MODEL, ANTHROPIC_EFFORT, COMPARE_OUT
// Run: npx tsx scripts/compare-models.ts
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { parseStoredContext } from "../src/lib/ai/context";
import { buildPredictionRequest, parsePredictionOutput, type AIPredictionOutput } from "../src/lib/ai/analysis";
import { stripUnsupportedClaims } from "../src/lib/ai/evidenceClaims";
import { resolveGenerationRisk } from "../src/lib/ai/generationRisk";
import { marketBreadthForCategories } from "../src/lib/doublesTargeting";
import { geminiProvider } from "../src/lib/ai/providers/gemini";
import { makeAnthropicProvider, type AnthropicEffort } from "../src/lib/ai/providers/anthropic";
import type { AIProvider, CompletionRequest } from "../src/lib/ai/providers/types";
import { isValidSelection, resolveMarket, type MarketType } from "../src/lib/markets";
import { scanDraftForCertainty } from "../src/lib/certaintyLanguage";
import { scanDraftForInternalTerminology } from "../src/lib/houseVoice";
import { estimateCostUsd } from "../src/lib/generation/stats";

const N = Math.max(1, Number(process.env.COMPARE_N) || 30);

/**
 * GEMINI_BASELINE=published: Gemini's column is the pick production actually
 * published for the fixture (made before kickoff, now settled), and Gemini is
 * not called at all. Costs nothing on the Gemini side and is the real baseline;
 * its token and cost columns read zero. Default: call Gemini afresh.
 */
const PUBLISHED_BASELINE = process.env.GEMINI_BASELINE === "published";

/**
 * Appended to the production system prompt for the "tuned" Claude arm only.
 * Every arm gets the identical production prompt and evidence; this adds, and
 * removes nothing. The rules above it were written while watching Gemini, and
 * Haiku read rule 8's caution as "default to DOUBLE_CHANCE" (29 of 30 in the
 * first comparison) although rule 8 says DOUBLE_CHANCE is not the default.
 */
const CLAUDE_TUNING = `

9. HOW TO APPLY RULE 8. Work through rule 8 literally, in order, before choosing:
   (a) Place the fixture in ONE band and name the signals that put it there.
   (b) EXTREME MISMATCH means MATCH_WINNER. Do not hedge it.
   (c) Otherwise name the primary way the pick would LOSE — a draw, an opponent
       win, the side failing to control ninety minutes, or a result the evidence
       cannot call — and take the market rule 8 maps that failure mode to.
       DOUBLE_CHANCE is correct only when the named risk is an opponent win.
   (d) When the scoring evidence (goals for and against, clean sheets, both
       teams scoring) is clearer than the result evidence, prefer the goals
       market it supports over any side hedge.
   Caution is expressed through the band and the confidence you report, not by
   reaching for the same market on every fixture.`;

/** Claude setups compared against Gemini, from CLAUDE_ARMS (comma-separated: default, low, medium, high, each optionally +tuned). */
const ARMS = (process.env.CLAUDE_ARMS || "default").split(",").map((raw) => {
  const [effort, tuned] = raw.trim().split("+");
  return {
    key: raw.trim(),
    label: `Claude ${effort === "default" ? "default effort" : `${effort} effort`}${tuned ? " + tuned wording" : ""}`,
    provider: makeAnthropicProvider(effort === "default" ? {} : { effort: effort as AnthropicEffort }),
    tuned: tuned === "tuned",
  };
});
const OUT = process.env.COMPARE_OUT ?? "./_compare";

type Score = {
  ok: boolean;
  error?: string;
  validPicks: number;
  totalPicks: number;
  removedSentences: number;
  wouldReject: string | null;
  topPick: string | null;
  topConfidence: number | null;
  outcome: "WON" | "LOST" | "VOID" | null;
  promptTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  output?: AIPredictionOutput;
};

export async function run(provider: AIProvider, request: CompletionRequest, digest: any, final: { home: number; away: number }): Promise<Score> {
  const started = Date.now();
  const empty: Score = { ok: false, validPicks: 0, totalPicks: 0, removedSentences: 0, wouldReject: null, topPick: null, topConfidence: null, outcome: null, promptTokens: 0, outputTokens: 0, costUsd: 0, ms: 0 };
  let res;
  try {
    res = await provider.complete(request);
  } catch (err: any) {
    return { ...empty, error: `${err?.name ?? "Error"}: ${String(err?.message ?? err).slice(0, 160)}`, ms: Date.now() - started };
  }
  const ms = Date.now() - started;
  const pt = res.usage.promptTokens ?? 0;
  const ot = res.usage.outputTokens ?? 0;
  const base = { ...empty, promptTokens: pt, outputTokens: ot, costUsd: estimateCostUsd(res.model, pt, ot), ms };
  let output: AIPredictionOutput;
  try {
    output = parsePredictionOutput(res.text);
  } catch {
    return { ...base, error: "non-JSON output" };
  }
  const picks = Array.isArray(output.predictions) ? output.predictions : [];
  const valid = picks.filter((p) => isValidSelection(p.marketType as MarketType, p.selection));
  const cleaned = stripUnsupportedClaims(digest, output);
  const prose = { matchPreview: cleaned.output.matchPreview, keyFactors: cleaned.output.keyFactors, reasoning: cleaned.output.predictions.map((p) => p.reasoning).join("\n\n") };
  const wouldReject = cleaned.emptied
    ? "pick left without reasoning"
    : scanDraftForCertainty(prose).length
      ? "certainty language"
      : scanDraftForInternalTerminology(prose).length
        ? "internal terminology"
        : valid.length === 0
          ? "no valid pick"
          : null;
  const top = [...valid].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  return {
    ...base,
    ok: true,
    validPicks: valid.length,
    totalPicks: picks.length,
    removedSentences: cleaned.removed.length,
    wouldReject,
    topPick: top ? `${top.marketType} ${JSON.stringify(top.selection)}` : null,
    topConfidence: top?.confidence ?? null,
    outcome: top && !wouldReject ? resolveMarket(top.marketType as MarketType, top.selection, final.home, final.away) : null,
    output: cleaned.output,
  };
}

export function summary(name: string, scores: Score[]) {
  const ok = scores.filter((s) => s.ok);
  const usable = ok.filter((s) => !s.wouldReject);
  const settled = usable.filter((s) => s.outcome === "WON" || s.outcome === "LOST");
  const won = settled.filter((s) => s.outcome === "WON").length;
  const sum = (f: (s: Score) => number) => scores.reduce((a, s) => a + f(s), 0);
  const avg = (f: (s: Score) => number) => (scores.length ? sum(f) / scores.length : 0);
  const conf = usable.filter((s) => s.topConfidence != null);
  const marketCounts = usable.reduce<Record<string, number>>((m, s) => {
    const k = s.topPick?.split(" ")[0] ?? "-";
    return { ...m, [k]: (m[k] ?? 0) + 1 };
  }, {});
  return {
    name,
    calls: scores.length,
    validJson: ok.length,
    usable: usable.length,
    rejectedBy: Object.entries(ok.reduce<Record<string, number>>((m, s) => (s.wouldReject ? { ...m, [s.wouldReject]: (m[s.wouldReject] ?? 0) + 1 } : m), {})),
    sentencesRemoved: sum((s) => s.removedSentences),
    markets: Object.entries(marketCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/_/g, " ").toLowerCase()} ${v}`).join(", "),
    winRate: settled.length ? `${won}/${settled.length} (${Math.round((won / settled.length) * 100)}%)` : "—",
    avgConfidence: conf.length ? Math.round(conf.reduce((a, s) => a + (s.topConfidence ?? 0), 0) / conf.length) : null,
    avgIn: Math.round(avg((s) => s.promptTokens)),
    avgOut: Math.round(avg((s) => s.outputTokens)),
    costTotal: sum((s) => s.costUsd),
    costPerCall: avg((s) => s.costUsd),
    p50ms: [...scores].map((s) => s.ms).sort((a, b) => a - b)[Math.floor(scores.length / 2)] ?? 0,
  };
}

async function main() {
  if (process.env.REQUIRE_READ_ONLY === "1") {
    const [ro] = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro?.transaction_read_only !== "on") throw new Error(`refusing: session is not read-only (transaction_read_only = ${ro?.transaction_read_only})`);
    console.log("session verified read-only (transaction_read_only = on)");
  }
  for (const p of [...(PUBLISHED_BASELINE ? [] : [geminiProvider]), ARMS[0].provider]) if (!p.isConfigured()) throw new Error(`${p.name} is not configured (missing API key)`);

  // Settled single-market picks from ordinary scheduled generation, newest first.
  const rows = await prisma.prediction.findMany({
    where: { outcome: { in: ["WON", "LOST"] }, finalHomeScore: { not: null }, finalAwayScore: { not: null }, aiJobId: { not: null } },
    orderBy: { kickoff: "desc" },
    take: N * 6,
    select: { aiJobId: true, homeTeam: true, awayTeam: true, finalHomeScore: true, finalAwayScore: true, outcome: true, marketType: true, selection: true, confidence: true, aiJob: { select: { prompt: true, context: true, model: true } } },
  });
  const seen = new Set<string>();
  const samples: Array<{ label: string; request: CompletionRequest; digest: any; final: { home: number; away: number }; publishedOutcome: string; published: Score }> = [];
  // The published pick per job is its highest-confidence row, the same rule
  // the harness uses to choose each model's top pick.
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.aiJobId) continue;
    const cur = best.get(r.aiJobId);
    if (!cur || (r.confidence ?? 0) > (cur.confidence ?? 0)) best.set(r.aiJobId, r);
  }
  for (const r of rows) {
    if (samples.length >= N) break;
    if (!r.aiJobId || seen.has(r.aiJobId) || !r.aiJob) continue;
    seen.add(r.aiJobId);
    let input: any;
    try { input = JSON.parse(r.aiJob.prompt); } catch { continue; }
    // Ordinary generation only: the same prompt both models can be fairly given.
    if (input.intent || input.manual || input.handicapLine || input.rewriteOf) continue;
    const categories: string[] = Array.isArray(input.categories) ? input.categories : [];
    if (categories.includes("SAME_GAME_DOUBLE")) continue;
    const digest = parseStoredContext(r.aiJob.context);
    if (!digest) continue;
    const route = resolveGenerationRisk(categories, input.leagueApiId);
    const request = buildPredictionRequest({
      digest,
      tiers: route.promptTiers,
      riskCalibration: route.calibration !== "legacy",
      marketBreadth: marketBreadthForCategories(categories),
    });
    const top = best.get(r.aiJobId)!;
    const published: Score = {
      ok: true, validPicks: 1, totalPicks: 1, removedSentences: 0, wouldReject: null,
      topPick: `${top.marketType} ${JSON.stringify(top.selection)}`,
      topConfidence: top.confidence ?? null,
      outcome: top.outcome as Score["outcome"],
      promptTokens: 0, outputTokens: 0, costUsd: 0, ms: 0,
    };
    samples.push({ label: `${r.homeTeam} v ${r.awayTeam}`, request, digest, final: { home: r.finalHomeScore!, away: r.finalAwayScore! }, publishedOutcome: r.outcome, published });
  }
  console.log(`${samples.length} settled fixtures (asked for ${N}); model calls: ${samples.length * 2}`);
  if (!samples.length) throw new Error("no settled ordinary-generation fixtures with stored evidence");

  const gemini: Score[] = [];
  const claude: Score[][] = ARMS.map(() => []);
  const perFixture: unknown[] = [];
  for (const [i, s] of samples.entries()) {
    const tunedRequest = { ...s.request, system: s.request.system + CLAUDE_TUNING };
    const [g, ...cs] = await Promise.all([
      PUBLISHED_BASELINE ? Promise.resolve(s.published) : run(geminiProvider, s.request, s.digest, s.final),
      ...ARMS.map((a) => run(a.provider, a.tuned ? tunedRequest : s.request, s.digest, s.final)),
    ]);
    gemini.push(g);
    cs.forEach((c, k) => claude[k].push(c));
    const line = (x: Score) => (x.ok ? `${x.topPick ?? "-"} @${x.topConfidence ?? "?"}% ${x.wouldReject ? `[REJECT: ${x.wouldReject}]` : x.outcome ?? ""}` : `ERROR ${x.error}`);
    console.log(`${String(i + 1).padStart(2)}. ${s.label} ${s.final.home}-${s.final.away}\n    gemini: ${line(g)}${ARMS.map((a, k) => `\n    ${a.key}: ${line(cs[k])}`).join("")}`);
    perFixture.push({ fixture: s.label, final: s.final, publishedOutcome: s.publishedOutcome, gemini: g, ...Object.fromEntries(ARMS.map((a, k) => [`claude_${a.key}`, cs[k]])) });
  }

  const rows2 = [
    summary(PUBLISHED_BASELINE ? "Gemini, as published (no new calls)" : `Gemini (${process.env.GEMINI_MODEL || "gemini-3.7-flash"})`, gemini),
    ...ARMS.map((a, k) => summary(a.label, claude[k])),
  ];
  const md = [
    `## Model comparison — ${samples.length} settled fixtures`,
    "",
    "| | " + rows2.map((r) => r.name).join(" | ") + " |",
    "|---|" + rows2.map(() => "---").join("|") + "|",
    ...([
      ["Valid JSON", (r: any) => `${r.validJson}/${r.calls}`],
      ["Usable (passes the gates)", (r: any) => `${r.usable}/${r.calls}`],
      ["Would be rejected by", (r: any) => (r.rejectedBy.length ? r.rejectedBy.map(([k, v]: any) => `${k} ×${v}`).join(", ") : "—")],
      ["Sentences the evidence checks remove", (r: any) => String(r.sentencesRemoved)],
      ["Top pick won", (r: any) => r.winRate],
      ["Top-pick markets", (r: any) => r.markets],
      ["Avg top-pick confidence", (r: any) => (r.avgConfidence == null ? "—" : `${r.avgConfidence}%`)],
      ["Avg input / output tokens", (r: any) => `${r.avgIn.toLocaleString()} / ${r.avgOut.toLocaleString()}`],
      ["Est. cost per call", (r: any) => `$${r.costPerCall.toFixed(4)}`],
      ["Est. cost, this run", (r: any) => `$${r.costTotal.toFixed(3)}`],
      ["Latency p50", (r: any) => `${(r.p50ms / 1000).toFixed(1)}s`],
    ] as const).map(([label, f]) => `| ${label} | ${rows2.map(f).join(" | ")} |`),
    "",
    "Win rate is on a small sample of already-settled matches: treat it as a sanity check, not a verdict. The full outputs for side-by-side reading are in the run artifact.",
  ].join("\n");
  console.log("\n" + md);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/summary.md`, md);
  writeFileSync(`${OUT}/fixtures.json`, JSON.stringify(perFixture, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}

if (require.main === module) main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
