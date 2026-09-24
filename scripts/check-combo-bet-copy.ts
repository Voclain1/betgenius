/**
 * Combo Bet: rendering, house voice, and the display-layer rename.
 *
 * Three regressions this locks down, all of which shipped to real readers:
 *   - literal ** on every published combo card;
 *   - the same boilerplate sentence opening every combo;
 *   - reasoning that narrated our own tiers and calibrations at the reader.
 *
 * Read-only. Run: npx tsx scripts/check-combo-bet-copy.ts
 */
export {};

import type { ComboLegRow } from "./backfill-combo-leg-labels";

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { toParagraphs, stripInlineMarkers } = await import("../src/components/Prose");
  const { scanDraftForInternalTerminology, PROHIBITED_INTERNAL_TERMS, internalTerminologyProhibitionBlock } =
    await import("../src/lib/houseVoice");
  const { CATEGORY_SLUGS, CATEGORY_NAMES, CATEGORY_TO_SLUG } = await import("../src/lib/categoryPredictions");
  const { deriveMarketAndPick } = await import("../src/lib/markets");
  const { rewriteComboReasoning } = await import("./backfill-combo-bet-copy");
  const { describeComboLeg } = await import("../src/lib/markets");
  const { reconstructComboPick, readLegIds } = await import("./backfill-combo-leg-labels");

  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  console.log("markdown never reaches the reader:");
  check("bold markers are removed", stripInlineMarkers("**Under 2.5 Goals** — 74%") === "Under 2.5 Goals — 74%");
  check("a real combo body renders without asterisks",
    !toParagraphs("**Both parts must land.**\n\n**Under 2.5** — 74%\nEvidence.").join(" ").includes("*"));
  check("blank lines still split paragraphs", toParagraphs("One.\n\nTwo.").length === 2);
  check("a single newline does not split", toParagraphs("One.\nstill one.").length === 1);

  console.log("\nthe house voice scan catches REAL leaked sentences:");
  // Verbatim from published rows before the fix.
  const real = [
    "In line with the Genius tier risk calibration for cup knockout fixtures, backing Os Limianos with the double chance hedge is sound.",
    "In accordance with risk calibration guidelines, Double Chance provides coverage.",
    "In line with VIP risk calibration, backing Leeds to secure at least a point offers a well-hedged position.",
    "Backing Turan on the double chance provides a well-supported hedge under Genius calibration.",
    "5 match goals offers a well-grounded probabilistic position under GENIUS calibration.",
  ];
  for (const [i, sentence] of real.entries()) {
    const hits = scanDraftForInternalTerminology({ reasoning: sentence });
    check(`real leak #${i + 1} rejected`, hits.length > 0, hits[0]?.label ?? "NOT CAUGHT");
  }

  console.log("\nand does NOT fire on ordinary football writing:");
  const legit = [
    "Sarajevo have kept clean sheets in both league games, scoring once.",
    "A moment of genius from the winger settled a tight game.",
    "Leeds are a second-tier side adapting to the system their new coach prefers.",
    "He is a premium finisher in and around the six-yard box.",
    "Their last ten meetings produced under 2.5 goals eight times.",
    "The visitors sit one tier below the champions in table position.",
    "Under pressure at home, Orenburg have drawn three straight.",
  ];
  for (const sentence of legit) {
    const hits = scanDraftForInternalTerminology({ reasoning: sentence });
    check(`clean: "${sentence.slice(0, 44)}..."`, hits.length === 0, hits.map((h) => h.label).join(",") || "");
  }

  console.log("\nevery pattern is a REAL regex, not a corrupted one:");
  // Three patterns were written as new RegExp template strings and one survived
  // as a literal backspace byte (0x08) in the source. Both forms match nothing,
  // silently, while this suite still passed because a different rule caught the
  // same sentences. Assert the property directly.
  const BACKSPACE = String.fromCharCode(8);
  check("no pattern contains a literal backspace byte",
    PROHIBITED_INTERNAL_TERMS.every((t) => !t.pattern.source.includes(BACKSPACE)),
    PROHIBITED_INTERNAL_TERMS.filter((t) => t.pattern.source.includes(BACKSPACE)).map((t) => t.label).join(",") || "");
  // Each rule must be individually load-bearing: a sentence only IT catches.
  const perPattern: Array<[string, string]> = [
    ["Genius/VIP tier as a system concept", "Backing them is sound given Genius tier guidelines here."],
    ["under the <tier>", "A resilient position under the VIP approach to this market."],
    ["in line with the <tier>/risk", "In line with risk appetite, the hedge is the call."],
    ["risk profile/management", "A risk management view favours the hedge."],
    ["safety calibrations", "Under safety calibrations the hedge is preferred."],
  ];
  for (const [label, sentence] of perPattern) {
    const term = PROHIBITED_INTERNAL_TERMS.find((t) => t.label === label);
    check(`"${label}" actually matches`, !!term && term.pattern.test(sentence));
  }

  console.log("\nprompt and scan are generated from ONE list:");
  const block = internalTerminologyProhibitionBlock();
  check("every term appears in the prompt block", PROHIBITED_INTERNAL_TERMS.every((t) => block.includes(t.label)));
  check("the prompt shows a concrete bad/good pair", block.includes("BAD:") && block.includes("GOOD:"));

  console.log("\nthe boilerplate opener is gone and stays gone:");
  const before = "**Both parts must land for this to win.**\n\n**Akhmat or Draw** — 72% confidence\nAkhmat have scored freely.";
  const after = rewriteComboReasoning(before);
  check("opener stripped", !/Both parts must land/i.test(after));
  check("asterisks stripped", !after.includes("*"));
  check("the analysis itself survives", after.includes("Akhmat have scored freely."));
  check("rewrite is idempotent", rewriteComboReasoning(after) === after);

  console.log("\na combo leg names its own market when the pick alone is ambiguous:");
  const HOME = "Doma United";
  const AWAY = "Rivers United";
  const comboLeg = (marketType: string, selection: unknown) =>
    describeComboLeg(marketType as never, selection as never, HOME, AWAY);

  // The reported bug: a bare "No" concatenated onto another leg.
  check("BTTS NO reads BTTS No", comboLeg("BTTS", { value: "NO" }) === "BTTS No", comboLeg("BTTS", { value: "NO" }));
  check("BTTS YES reads BTTS Yes", comboLeg("BTTS", { value: "YES" }) === "BTTS Yes", comboLeg("BTTS", { value: "YES" }));

  // Every other market's pick is already self-contained and must pass through
  // byte-identical, so this fix cannot quietly restyle the rest of the feed.
  const passthrough: Array<[string, unknown, string]> = [
    ["DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, "Doma United or Draw"],
    ["OVER_UNDER", { line: 2.5, direction: "OVER" }, "Over 2.5 Goals"],
    ["MATCH_WINNER", { value: "HOME" }, "Doma United to win"],
    ["TEAM_TOTAL", { side: "HOME", line: 1.5, direction: "OVER" }, "Doma United Over 1.5 Goals"],
    ["DRAW_NO_BET", { value: "AWAY" }, "Rivers United (draw no bet)"],
    ["WIN_EITHER_HALF", { value: "HOME" }, "Doma United to win either half"],
    ["HT_FT", { ht: "DRAW", ft: "HOME" }, "Draw at HT / Doma United at FT"],
    ["EUROPEAN_HANDICAP", { value: "HOME", line: -1 }, "Doma United (Doma United -1)"],
  ];
  for (const [marketType, selection, expected] of passthrough) {
    const got = comboLeg(marketType, selection);
    check(`${marketType} passes through unchanged`, got === expected, got);
    check(`${marketType} matches its standalone pick`,
      got === deriveMarketAndPick(marketType as never, selection as never, HOME, AWAY).pick);
  }

  // The standalone card shows market and pick on separate lines, so its BTTS
  // pick must stay a bare Yes/No - otherwise the card would read "Both Teams
  // to Score / BTTS No".
  console.log("\nand a STANDALONE BTTS card is left exactly as it was:");
  const bttsNo = deriveMarketAndPick("BTTS", { value: "NO" } as never, HOME, AWAY);
  const bttsYes = deriveMarketAndPick("BTTS", { value: "YES" } as never, HOME, AWAY);
  check("standalone BTTS NO still derives pick No", bttsNo.pick === "No", bttsNo.pick);
  check("standalone BTTS YES still derives pick Yes", bttsYes.pick === "Yes", bttsYes.pick);
  check("standalone BTTS still shows the market separately", bttsNo.market === "Both Teams to Score", bttsNo.market);

  console.log("\nthe stored-row backfill rebuilds combo pick text from the legs:");
  const leg = (id: string, marketType: string, selection: unknown, pick: string): ComboLegRow => ({
    id, marketType, selection, market: "", pick, homeTeam: HOME, awayTeam: AWAY,
  });
  const legBook = new Map<string, ComboLegRow>([
    ["dc", leg("dc", "DOUBLE_CHANCE", { value: "HOME_OR_DRAW" }, "Doma United or Draw")],
    ["bttsNo", leg("bttsNo", "BTTS", { value: "NO" }, "No")],
    ["bttsYes", leg("bttsYes", "BTTS", { value: "YES" }, "Yes")],
    ["ou", leg("ou", "OVER_UNDER", { line: 2.5, direction: "OVER" }, "Over 2.5 Goals")],
    ["mw", leg("mw", "MATCH_WINNER", { value: "HOME" }, "Doma United to win")],
  ]);
  const rebuilt = (a: string, b: string) => reconstructComboPick({ legIds: [a, b] }, legBook);
  const pickOf = (a: string, b: string) => {
    const r = rebuilt(a, b);
    return r.ok ? r.pick : `SKIPPED:${r.reason}`;
  };

  check("Double Chance + BTTS No", pickOf("dc", "bttsNo") === "Doma United or Draw + BTTS No", pickOf("dc", "bttsNo"));
  check("Double Chance + BTTS Yes", pickOf("dc", "bttsYes") === "Doma United or Draw + BTTS Yes", pickOf("dc", "bttsYes"));
  check("BTTS Yes + Over 2.5 Goals", pickOf("bttsYes", "ou") === "BTTS Yes + Over 2.5 Goals", pickOf("bttsYes", "ou"));
  check("Match Winner + BTTS No", pickOf("mw", "bttsNo") === "Doma United to win + BTTS No", pickOf("mw", "bttsNo"));
  // Leg order comes from the stored legIds rather than being re-derived, so a
  // repaired row keeps reading the way it always did apart from the label.
  check("leg order follows legIds", pickOf("bttsNo", "dc") === "BTTS No + Doma United or Draw", pickOf("bttsNo", "dc"));

  // Idempotence: the backfill writes only where the text differs, so a second
  // pass over its own output must find nothing to do. Feed the repaired pick
  // back in as the stored one and assert it reconstructs unchanged.
  const repairedRow = { pick: pickOf("dc", "bttsNo"), selection: { legIds: ["dc", "bttsNo"] } };
  const secondPass = reconstructComboPick(repairedRow.selection, legBook);
  check("backfill is idempotent", secondPass.ok && secondPass.pick === repairedRow.pick,
    secondPass.ok ? secondPass.pick : secondPass.reason);
  check("an untouched combo reconstructs to itself", pickOf("ou", "mw") === "Over 2.5 Goals + Doma United to win");

  console.log("\nmalformed historical doubles are skipped, never guessed at:");
  const malformed: Array<[string, unknown, string]> = [
    ["selection is null", null, "NO_LEG_IDS"],
    ["selection has no legIds", { value: "HOME" }, "NO_LEG_IDS"],
    ["legIds is not an array", { legIds: "dc,bttsNo" }, "BAD_LEG_IDS"],
    ["only one leg id", { legIds: ["dc"] }, "BAD_LEG_IDS"],
    ["three leg ids", { legIds: ["dc", "bttsNo", "ou"] }, "BAD_LEG_IDS"],
    ["a leg id is empty", { legIds: ["dc", ""] }, "BAD_LEG_IDS"],
    ["the same leg twice", { legIds: ["dc", "dc"] }, "BAD_LEG_IDS"],
    ["a referenced leg row is gone", { legIds: ["dc", "deleted-row"] }, "LEG_ROW_MISSING"],
  ];
  for (const [label, selection, reason] of malformed) {
    const r = reconstructComboPick(selection, legBook);
    check(`${label} -> ${reason}`, !r.ok && r.reason === reason, r.ok ? `rewrote to "${r.pick}"` : r.reason);
  }
  check("readLegIds accepts only the shape the assembler writes",
    JSON.stringify(readLegIds({ legIds: ["dc", "bttsNo"] })) === JSON.stringify(["dc", "bttsNo"]));

  console.log("\nthe rename is consistent across every user-facing surface:");
  check("route slug is combo-bets", CATEGORY_SLUGS["combo-bets"] === "SAME_GAME_DOUBLE");
  check("the old slug is no longer a route", CATEGORY_SLUGS["same-game-doubles"] === undefined);
  check("category name reads Combo Bets", CATEGORY_NAMES.SAME_GAME_DOUBLE === "Combo Bets");
  check("market label reads Combo Bet",
    deriveMarketAndPick("SAME_GAME_DOUBLE", null as never).market === "Combo Bet",
    deriveMarketAndPick("SAME_GAME_DOUBLE", null as never).market);
  check("slug lookup round-trips", CATEGORY_TO_SLUG.SAME_GAME_DOUBLE === "combo-bets");
  // The sitemap derives from this map; lowercasing the enum used to emit
  // /predictions/same_game_double, which 404s.
  check("no category slug contains an underscore",
    Object.values(CATEGORY_TO_SLUG).every((s) => !s.includes("_")), Object.values(CATEGORY_TO_SLUG).join(","));
  check("the enum value is UNCHANGED (display-layer rename only)",
    CATEGORY_SLUGS["combo-bets"] === "SAME_GAME_DOUBLE");

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
