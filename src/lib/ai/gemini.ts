import { GoogleGenAI } from "@google/genai";
import { AUTO_MARKET_TYPES, type MarketType, type Selection } from "@/lib/markets";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

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

export async function generatePredictionForFixture(input: {
  home: string;
  away: string;
  league: string;
  kickoff: string;
  homeContext?: unknown;
  awayContext?: unknown;
  h2h?: unknown;
  standings?: unknown;
}): Promise<AIPredictionOutput> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

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

Return JSON only. marketType must be one of: ${AUTO_MARKET_TYPES.join(", ")}.`;

  const res = await client.models.generateContent({
    model: MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
    },
  });

  const text = (res.text ?? "").trim();

  // strip accidental code fences
  const cleaned = text.replace(/^```json\s*|^```\s*|```$/gim, "").trim();

  try {
    return JSON.parse(cleaned) as AIPredictionOutput;
  } catch {
    throw new Error("AI returned non-JSON output: " + text.slice(0, 400));
  }
}
