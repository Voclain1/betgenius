// A/B harness for the context digest (src/lib/ai/digest.ts).
//
// For each fixture it fetches the raw api-football context once, then builds
// BOTH prompts from it — the old one (raw payloads, JSON.stringify(x, null, 2))
// and the new one (MatchDigest, compact) — so the comparison is over identical
// evidence rather than two separate fetches.
//
// Always reports: prompt bytes, reduction ratio, digest coverage flags, and how
// far the season-long injury log collapsed to a current availability list.
//
// With MODEL_CALLS=1 it additionally counts input tokens via Gemini's
// countTokens endpoint and runs both prompts, recording latency, output tokens
// and full text for side-by-side quality review. That half needs reachable
// access to generativelanguage.googleapis.com — some networks block it by SNI,
// in which case the byte/structure half still runs.
//
// Deliberately does not touch the database: nothing here needs to persist, and
// it must stay runnable before `prisma db push` adds the AIJob token columns.
//
// Run: npx tsx --env-file=.env scripts/validate-digest.ts
//      MODEL_CALLS=1 npx tsx --env-file=.env scripts/validate-digest.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import {
  getTeamContext, getStandings, getHeadToHead, searchTeam, resolveSeason, getFixturesByLeague,
  type FixtureRow, type StandingsEntry,
} from "../src/lib/football/api-football";
import { buildMatchDigest, type MatchDigest } from "../src/lib/ai/digest";
import { AUTO_MARKET_TYPES } from "../src/lib/markets";

const OUT_DIR = process.env.VALIDATE_OUT ?? "./_validation";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Copied verbatim from the pre-change src/lib/ai/gemini.ts so the comparison is
// against what actually shipped, not a paraphrase of it.
const OLD_SYSTEM = `You are BetGenius, an expert football analyst.
You produce probabilistic match analyses grounded in the data you are given.

Rules:
1. Only use the fixture, form, injuries and standings data provided in the user message.
   Do NOT invent players, transfers, or scores.
2. Return CONFIDENCE as a probability estimate (0-100). Be conservative — do not exceed 90
   unless the data is overwhelming.
3. Never claim a prediction is guaranteed. Frame outputs as probabilities.
4. Every prediction has a primary pick, expressed as "marketType" + "selection", using ONLY
   one of these five marketType values and the EXACT matching selection shape:

   - "MATCH_WINNER"   -> selection: { "value": "HOME" | "DRAW" | "AWAY" }
   - "DOUBLE_CHANCE"  -> selection: { "value": "HOME_OR_DRAW" | "AWAY_OR_DRAW" | "HOME_OR_AWAY" }
   - "OVER_UNDER"     -> selection: { "line": number, "direction": "OVER" | "UNDER" }   // e.g. line 2.5
   - "BTTS"           -> selection: { "value": "YES" | "NO" }
   - "CORRECT_SCORE"  -> selection: { "home": integer >= 0, "away": integer >= 0 }

   Do not invent other marketType values and do not deviate from these selection shapes.
5. Every prediction ALSO has a separate, always-present total-goals over/under call —
   "overUnderLine" (a number, e.g. 2.5) and "overUnderDirection" ("OVER" | "UNDER") —
   independent of whatever the primary marketType/selection is about.
6. Output STRICT JSON matching this TypeScript type — no markdown fences, no commentary:

{
  "matchPreview": string,          // 2-4 short paragraphs in markdown
  "predictions": [
    {
      "marketType": "MATCH_WINNER" | "DOUBLE_CHANCE" | "OVER_UNDER" | "BTTS" | "CORRECT_SCORE",
      "selection": { ... shape per marketType, see rule 4 ... },
      "overUnderLine": number,
      "overUnderDirection": "OVER" | "UNDER",
      "confidence": number,
      "reasoning": string
    }
  ],
  "keyFactors": string[]           // 3-6 bullet points
}`;

function oldPrompt(f: { home: string; away: string; league: string; kickoff: string }, homeContext: unknown, awayContext: unknown, h2h: unknown, standings: unknown) {
  return `Analyse this fixture and return JSON only.

Fixture:
- ${f.home} vs ${f.away}
- League: ${f.league}
- Kickoff: ${f.kickoff}

Home team recent context:
${JSON.stringify(homeContext ?? {}, null, 2)}

Away team recent context:
${JSON.stringify(awayContext ?? {}, null, 2)}

Head to head:
${JSON.stringify(h2h ?? {}, null, 2)}

League standings:
${JSON.stringify(standings ?? {}, null, 2)}

Return JSON only. marketType must be one of: ${AUTO_MARKET_TYPES.join(", ")}.`;
}

// Mirrors the post-change gemini.ts. Kept here rather than imported so the
// harness compares two frozen strings instead of chasing later edits.
const NEW_SYSTEM = OLD_SYSTEM.replace(
  `1. Only use the fixture, form, injuries and standings data provided in the user message.
   Do NOT invent players, transfers, or scores.`,
  `1. Only use the fixture, form, availability and standings data provided in the user message.
   Do NOT invent players, transfers, or scores. Every player name, number, scoreline
   and percentage you write must appear in that data. If you want to say something the
   data does not support, leave it out.
1b. The data is a DIGEST with a "coverage" object saying which parts resolved. Where
   coverage is false, that section is UNKNOWN, not empty — say nothing about it rather
   than treating it as an absence. In particular: coverage.availability false means the
   team-news feed did not resolve, NOT that both squads are fully fit. An empty
   "availability" list WITH coverage.availability true does mean nobody is reported out.
1c. "availability" lists players unavailable for the upcoming match, each with a kind:
   "injury" (fitness), "suspension" (certain, serves out), "unavailable" (not selected —
   do not describe these as injured). "availabilityAsOf" is the matchday the list was
   read from; if it is well before kickoff, treat it as indicative rather than current.`,
);

function newPrompt(d: MatchDigest) {
  return `Analyse this fixture and return JSON only.

Fixture:
- ${d.fixture.home} (home) vs ${d.fixture.away} (away)
- League: ${d.fixture.league}
- Kickoff: ${d.fixture.kickoff}

Evidence digest (JSON):
${JSON.stringify(d)}

Return JSON only. marketType must be one of: ${AUTO_MARKET_TYPES.join(", ")}.`;
}

/** Set MODEL_CALLS=1 to also run generations. Off by default so the byte/structure half still runs on a network that blocks the model endpoint. */
const MODEL_CALLS = process.env.MODEL_CALLS === "1";

async function countTokens(system: string, user: string): Promise<number | null> {
  if (!MODEL_CALLS) return null;
  try {
    const r = await client.models.countTokens({ model: MODEL, contents: `${system}\n\n${user}` });
    return r.totalTokens ?? null;
  } catch (e: any) {
    console.error("   countTokens failed:", e?.message);
    return null;
  }
}

async function run(system: string, user: string) {
  const started = Date.now();
  const res = await client.models.generateContent({
    model: MODEL,
    contents: user,
    config: { systemInstruction: system, responseMimeType: "application/json" },
  });
  const latencyMs = Date.now() - started;
  const text = (res.text ?? "").trim().replace(/^```json\s*|^```\s*|```$/gim, "").trim();
  let parsed: any = null;
  let parseError: string | null = null;
  try { parsed = JSON.parse(text); } catch (e: any) { parseError = e.message; }
  const m = res.usageMetadata;
  return {
    latencyMs,
    modelVersion: res.modelVersion ?? null,
    promptTokens: m?.promptTokenCount ?? null,
    outputTokens: (m?.candidatesTokenCount ?? 0) + (m?.thoughtsTokenCount ?? 0) || null,
    thoughtTokens: m?.thoughtsTokenCount ?? null,
    totalTokens: m?.totalTokenCount ?? null,
    parsed, parseError, text,
  };
}

type Case = { label: string; leagueId: number; leagueName: string };

const CASES: Case[] = [
  // Calendar-year leagues: mid-season in August, so full stats/form/injuries.
  { label: "rich", leagueId: 113, leagueName: "Allsvenskan" },
  { label: "rich", leagueId: 114, leagueName: "Superettan" },
  { label: "rich", leagueId: 103, leagueName: "Eliteserien" },
  { label: "rich", leagueId: 71, leagueName: "Serie A (Brazil)" },
  { label: "rich", leagueId: 119, leagueName: "Superliga (Denmark)" },
  // Winter leagues: season just started, so near-empty stats — the edge case
  // the coverage flags exist for.
  { label: "sparse", leagueId: 140, leagueName: "La Liga" },
  { label: "sparse", leagueId: 39, leagueName: "Premier League" },
];

async function pickFixture(leagueId: number): Promise<{ f: FixtureRow; season: number } | null> {
  const season = await resolveSeason(leagueId, new Date());
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const rows = await getFixturesByLeague(leagueId, season, from, to);
  const ns = (rows ?? []).filter((f) => f.fixture.status.short === "NS");
  return ns.length ? { f: ns[0], season } : null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const results: any[] = [];

  for (const c of CASES) {
    console.log(`\n=== ${c.leagueName} (${c.label}) ===`);
    const picked = await pickFixture(c.leagueId);
    if (!picked) { console.log("   no upcoming fixture, skipping"); continue; }
    const { f, season } = picked;
    const homeName = f.teams.home.name;
    const awayName = f.teams.away.name;
    console.log(`   ${homeName} vs ${awayName}  ${f.fixture.date}`);

    // The fixture row already carries both team ids, so no searchTeam calls —
    // this is the same context generate.ts assembles, minus the name lookups.
    const [homeContext, awayContext, standings, h2h] = await Promise.all([
      getTeamContext(f.teams.home.id, c.leagueId, season),
      getTeamContext(f.teams.away.id, c.leagueId, season),
      getStandings(c.leagueId, season),
      getHeadToHead(f.teams.home.id, f.teams.away.id),
    ]);

    const fixtureMeta = { home: homeName, away: awayName, league: c.leagueName, kickoff: f.fixture.date };
    const digest = buildMatchDigest({
      ...fixtureMeta,
      homeApiId: f.teams.home.id,
      awayApiId: f.teams.away.id,
      homeContext, awayContext,
      standings: standings as StandingsEntry[] | null,
      h2h,
    });

    const oldUser = oldPrompt(fixtureMeta, homeContext, awayContext, h2h, standings);
    const newUser = newPrompt(digest);

    const [oldCount, newCount] = await Promise.all([
      countTokens(OLD_SYSTEM, oldUser),
      countTokens(NEW_SYSTEM, newUser),
    ]);
    console.log(`   input tokens: old ${oldCount} -> new ${newCount}`);

    const oldRun = MODEL_CALLS ? await run(OLD_SYSTEM, oldUser) : null;
    const newRun = MODEL_CALLS ? await run(NEW_SYSTEM, newUser) : null;
    if (oldRun && newRun) {
      console.log(`   latency: old ${oldRun.latencyMs}ms -> new ${newRun.latencyMs}ms`);
      console.log(`   output tokens: old ${oldRun.outputTokens} -> new ${newRun.outputTokens}`);
    }

    const rawInj = (side: "home" | "away") => {
      const ctx = side === "home" ? homeContext : awayContext;
      const rows = Array.isArray(ctx.injuries) ? (ctx.injuries as any[]) : [];
      return { records: rows.length, distinctPlayers: new Set(rows.map((r) => r?.player?.name)).size };
    };
    console.log(
      `   bytes: old(pretty) ${oldUser.length} -> new(compact) ${newUser.length}` +
      `  (${(oldUser.length / Math.max(1, newUser.length)).toFixed(1)}x)`,
    );
    console.log(`   injuries raw home/away: ${rawInj("home").records}/${rawInj("away").records} records` +
      ` -> current ${digest.teams.home.availability.length}/${digest.teams.away.availability.length}`);

    results.push({
      league: c.leagueName, kind: c.label,
      fixture: `${homeName} vs ${awayName}`, kickoff: f.fixture.date,
      bytes: {
        oldPretty: oldUser.length,
        newCompact: newUser.length,
        rawCompact: JSON.stringify({ homeContext, awayContext, standings, h2h }).length,
        digestOnly: JSON.stringify(digest).length,
      },
      countTokens: { old: oldCount, new: newCount },
      coverage: digest.coverage,
      availability: {
        home: digest.teams.home.availability.length,
        away: digest.teams.away.availability.length,
        homeAsOf: digest.teams.home.availabilityAsOf,
        awayAsOf: digest.teams.away.availabilityAsOf,
        rawHome: rawInj("home"),
        rawAway: rawInj("away"),
      },
      old: oldRun, new: newRun,
      digest,
    });

    writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2));
  }

  console.log(`\nWrote ${results.length} cases to ${OUT_DIR}/results.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
