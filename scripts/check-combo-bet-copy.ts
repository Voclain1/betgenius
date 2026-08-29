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

const react = require("react");
react.cache = (fn: any) => fn;

async function main() {
  const { toParagraphs, stripInlineMarkers } = await import("../src/components/Prose");
  const { scanDraftForInternalTerminology, PROHIBITED_INTERNAL_TERMS, internalTerminologyProhibitionBlock } =
    await import("../src/lib/houseVoice");
  const { CATEGORY_SLUGS, CATEGORY_NAMES, CATEGORY_TO_SLUG } = await import("../src/lib/categoryPredictions");
  const { deriveMarketAndPick } = await import("../src/lib/markets");
  const { rewriteComboReasoning } = await import("./backfill-combo-bet-copy");

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
