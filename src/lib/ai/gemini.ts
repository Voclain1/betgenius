import { GoogleGenAI } from "@google/genai";
import { AUTO_MARKET_TYPES, type MarketType, type Selection } from "@/lib/markets";
import { withUnavailableRetry } from "@/lib/ai/retry";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Retry policy lives in ./retry so it can be tested with injected failures.
// It must wrap ONLY the model request below — see that module's note on why.

export type AIPredictionOutput = {
  matchPreview: string; // markdown
  predictions: Array<{
    marketType: MarketType;
    selection: Selection;
    overUnderLine: number;
    overUnderDirection: "OVER" | "UNDER";
    confidence: number; // 0-100
    reasoning: string; // markdown
  }>;
  keyFactors: string[];
  suggestedOdds?: number;
};

const SYSTEM_PROMPT = `You are BetGenius, an expert football analyst.
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
  "keyFactors": string[],          // 3-6 bullet points
  "suggestedOdds": number | null   // decimal odds for the top pick
}`;

/** The draft being replaced, shown to the model on a rewrite so it can't simply restate it. */
export type PreviousDraft = { matchPreview?: string | null; reasoning?: string | null; pick?: string | null; confidence?: number | null };

export async function generatePredictionForFixture(input: {
  home: string;
  away: string;
  league: string;
  kickoff: string;
  homeContext?: unknown;
  awayContext?: unknown;
  h2h?: unknown;
  standings?: unknown;
  /** Free-text admin direction for a rewrite, e.g. "the confidence feels too high given the h2h". */
  reviewerNote?: string | null;
  /** Present only on a rewrite — triggers the revision framing and higher sampling temperature. */
  previousDraft?: PreviousDraft | null;
}): Promise<AIPredictionOutput> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const isRewrite = !!input.previousDraft;

  // A rewrite without direction must still produce a genuinely new analysis,
  // not a paraphrase. Two things force that: the previous draft is shown with
  // an explicit instruction not to restate it, and temperature is raised below.
  // Showing the old draft matters more than temperature — at default sampling
  // the same prompt over the same context reliably returns near-identical text.
  const revisionBlock = isRewrite
    ? `
This is a REVISION of an earlier draft for the same fixture, using the same
underlying data. The previous draft was:

Pick: ${input.previousDraft?.pick ?? "(none)"} at ${input.previousDraft?.confidence ?? "?"}% confidence
Preview: ${input.previousDraft?.matchPreview ?? "(none)"}
Reasoning: ${input.previousDraft?.reasoning ?? "(none)"}

Produce a genuinely different analysis: re-examine the evidence, take a
different angle, and do not restate the sentences above. You may keep the same
pick if the data still supports it, but the preview and reasoning must be newly
written, and reconsider whether the confidence level is right.
`
    : "";

  const directionBlock = input.reviewerNote?.trim()
    ? `
REVIEWER DIRECTION — this is an explicit instruction from a human editor and
takes priority over your own stylistic preferences. Address it directly and
visibly in the new draft:

"${input.reviewerNote.trim()}"

Still obey every formatting and data-grounding rule above; the direction changes
emphasis, tone and judgement, never the output schema or the ban on inventing
facts not present in the data.
`
    : "";

  const userPrompt = `Analyse this fixture and return JSON only.

Fixture:
- ${input.home} vs ${input.away}
- League: ${input.league}
- Kickoff: ${input.kickoff}

Home team recent context:
${JSON.stringify(input.homeContext ?? {}, null, 2)}

Away team recent context:
${JSON.stringify(input.awayContext ?? {}, null, 2)}

Head to head:
${JSON.stringify(input.h2h ?? {}, null, 2)}

League standings:
${JSON.stringify(input.standings ?? {}, null, 2)}
${revisionBlock}${directionBlock}
Return JSON only. marketType must be one of: ${AUTO_MARKET_TYPES.join(", ")}.`;

  const res = await withUnavailableRetry(
    () =>
      client.models.generateContent({
        model: MODEL,
        contents: userPrompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          // Raised only for rewrites. First-pass generation stays on the model
          // default, where consistency is what's wanted; a rewrite is explicitly a
          // request for a different take, so the extra variance is the point.
          ...(isRewrite ? { temperature: 1.0 } : {}),
        },
      }),
    `${input.home} vs ${input.away}`,
  );

  const text = (res.text ?? "").trim();

  // strip accidental code fences
  const cleaned = text.replace(/^```json\s*|^```\s*|```$/gim, "").trim();

  try {
    return JSON.parse(cleaned) as AIPredictionOutput;
  } catch {
    throw new Error("AI returned non-JSON output: " + text.slice(0, 400));
  }
}
