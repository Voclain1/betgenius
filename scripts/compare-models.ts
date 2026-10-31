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
import { anthropicProvider } from "../src/lib/ai/providers/anthropic";
import type { AIProvider, CompletionRequest } from "../src/lib/ai/providers/types";
import { isValidSelection, resolveMarket, type MarketType } from "../src/lib/markets";
import { scanDraftForCertainty } from "../src/lib/certaintyLanguage";
import { scanDraftForInternalTerminology } from "../src/lib/houseVoice";
import { estimateCostUsd } from "../src/lib/generation/stats";

const N = Math.max(1, Number(process.env.COMPARE_N) || 30);
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
  return {
    name,
    calls: scores.length,
    validJson: ok.length,
    usable: usable.length,
    rejectedBy: Object.entries(ok.reduce<Record<string, number>>((m, s) => (s.wouldReject ? { ...m, [s.wouldReject]: (m[s.wouldReject] ?? 0) + 1 } : m), {})),
    sentencesRemoved: sum((s) => s.removedSentences),
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
  for (const p of [geminiProvider, anthropicProvider]) if (!p.isConfigured()) throw new Error(`${p.name} is not configured (missing API key)`);

  // Settled single-market picks from ordinary scheduled generation, newest first.
  const rows = await prisma.prediction.findMany({
    where: { outcome: { in: ["WON", "LOST"] }, finalHomeScore: { not: null }, finalAwayScore: { not: null }, aiJobId: { not: null } },
    orderBy: { kickoff: "desc" },
    take: N * 6,
    select: { aiJobId: true, homeTeam: true, awayTeam: true, finalHomeScore: true, finalAwayScore: true, outcome: true, aiJob: { select: { prompt: true, context: true, model: true } } },
  });
  const seen = new Set<string>();
  const samples: Array<{ label: string; request: CompletionRequest; digest: any; final: { home: number; away: number }; publishedOutcome: string }> = [];
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
    samples.push({ label: `${r.homeTeam} v ${r.awayTeam}`, request, digest, final: { home: r.finalHomeScore!, away: r.finalAwayScore! }, publishedOutcome: r.outcome });
  }
  console.log(`${samples.length} settled fixtures (asked for ${N}); model calls: ${samples.length * 2}`);
  if (!samples.length) throw new Error("no settled ordinary-generation fixtures with stored evidence");

  const gemini: Score[] = [];
  const claude: Score[] = [];
  const perFixture: unknown[] = [];
  for (const [i, s] of samples.entries()) {
    const [g, c] = await Promise.all([run(geminiProvider, s.request, s.digest, s.final), run(anthropicProvider, s.request, s.digest, s.final)]);
    gemini.push(g);
    claude.push(c);
    const line = (x: Score) => (x.ok ? `${x.topPick ?? "-"} @${x.topConfidence ?? "?"}% ${x.wouldReject ? `[REJECT: ${x.wouldReject}]` : x.outcome ?? ""}` : `ERROR ${x.error}`);
    console.log(`${String(i + 1).padStart(2)}. ${s.label} ${s.final.home}-${s.final.away}\n    gemini: ${line(g)}\n    claude: ${line(c)}`);
    perFixture.push({ fixture: s.label, final: s.final, publishedOutcome: s.publishedOutcome, gemini: g, claude: c });
  }

  const rows2 = [summary(`Gemini (${process.env.GEMINI_MODEL || "gemini-3.7-flash"})`, gemini), summary(`Claude (${process.env.ANTHROPIC_MODEL || "claude-haiku-5-5"}${process.env.ANTHROPIC_EFFORT ? `, effort ${process.env.ANTHROPIC_EFFORT}` : ""})`, claude)];
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
