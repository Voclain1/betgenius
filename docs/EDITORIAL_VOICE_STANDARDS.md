# Editorial voice standards for generated football writing

The match preview reads as football journalism; the reasoning reads as the analytical case for one pick. Neither shows the reader our working materials. Applies to first-pass generation and to both private rewrite paths.

## Where it lives

| Piece | File |
|---|---|
| Distinct briefs for `matchPreview` and `reasoning`, and uncertainty in football language | `editorialStandardsBlock()` in `src/lib/houseVoice.ts`, appended to every system prompt by `buildSystemPrompt` (all calibration modes, Goals and paid passes) |
| Reviewer direction: steers, never narrated | `reviewerDirectionBlock()` (replaces "address it directly and visibly") |
| Evidence-update rewrites (Prediction Updates workspace) | `evidenceUpdateBlock()`, via `evidenceUpdate: true`. The admin's note is passed only as private direction; the internal instructions that used to be appended to it are gone |
| Terms readers must never see | `PROHIBITED_INTERNAL_TERMS` (one list feeding the prompt and the scan) |
| Publication gate for rewrites | `src/lib/ai/proseGate.ts`: the same certainty and house-voice scans first-pass generation applies |

## The two briefs

**`matchPreview` (match journalism).**
- 2 to 4 polished paragraphs.
- Covers, wherever the data supports it: form, home and away records, relevant team news, tactical strengths and weaknesses, the stakes, and how the match should unfold.
- Leads with the football story, not a list of statistics.
- Leaves a topic out rather than describing the data.
- No betting talk.

**`reasoning` (the analytical case).**
- Explains, for the specific market, the two or three facts that carry the pick and the main risk to it.
- Uses plain betting words (double chance, over 2.5) but no technical jargon about how picks are produced.

**Uncertainty becomes football language, without inventing facts.**

| What the data shows | How the text handles it |
|---|---|
| No team news | No discussion of absences, no "full strength", no fit, doubtful or returning players |
| Old absence information | "Missed their last match" (never "is out") |
| Few games played | "Early-season form" |
| Lineups | Never called confirmed unless the confirmed lineup is in the data |
| Missing head-to-head or table information | Left out; never "unavailable" |

## What the scan now catches (new drafts and rewrites only)

Added to the existing list:
- **The evidence machinery:** digest, evidence snapshot, availability list, data or team-news coverage, coverage flags, "provides coverage", data feed, "the data did not resolve", "the supplied/provided data", null fields, field names such as `keyPlayers`, and JSON.
- **The review workflow:** reviewer, editor's note, "as requested", previous draft, "this rewrite", "originally published", "explanation updated", "selection, confidence and odds", evidence alerts, and monitoring signals.
- **AI wording:** "AI" and "artificial intelligence", per AGENTS.md.

**False positives are tested.** Every new pattern is phrase-bound, and 22 ordinary football sentences must pass, including:
- "an unchanged XI", "Arteta's selection was unchanged", "a lengthy VAR review";
- "a snapshot of their season", "Sky's live coverage", "fed the striker", "drafted in", "the data shows";
- "information provided by the club", "this version of Liverpool".

## What happens to existing content

- **Nothing published is modified automatically.**
- **The published-row backfill keeps its original reach.** `scripts/backfill-house-voice.ts` is pinned to the original 16 terms (`BACKFILL_TERM_LABELS`), so the new terms cannot trigger an edit of live copy.
- **Existing prose changes only through explicit admin review:**
  - the pending-review rewrite;
  - Prediction Updates: prepare a draft, then Approve & apply.
- **`npm run measure:editorial-voice -- --days=30`** (read-only, ids and labels only) reports:
  - how many recent rows trip the new terms (an upper bound on extra first-pass rejections);
  - which published rows an administrator may wish to review.

## Rewrite behaviour

**A rewrite whose wording fails the gate is refused, and nothing is saved:**
- the pending-review rewrite returns 422 and the draft, its history and its job are untouched;
- the workspace returns `REWRITE_PROSE_REJECTED` and no private draft is saved;
- a qualified replacement returns `REPLACEMENT_PROSE_REJECTED`.

**Replacement previews.** A qualified replacement no longer publishes the administrative line "Updated assessment based on newer match information." It now publishes no preview, and every public page already handles a missing preview.

## Unchanged

- Confidence rules and calculation.
- Market selection and calibration.
- Paid-tier routes and floors.
- API-Football budget safeguards (no provider calls are added).
- SEO and public pages.

## Tests

- **`scripts/check-editorial-voice.ts`** (preflight): prompt briefs in every mode and pass, existing rules preserved, first-pass vs rewrite vs evidence-rewrite prompts, every term exercised, the football false-positive corpus, a full house-style preview passing, rewrite gates placed before any write, and the backfill pinning.
- **`scripts/check-editorial-voice-postgres.ts`** (disposable Postgres, stubbed provider) runs the real pending-review rewrite and workspace rewrite. It checks:
  - the prompt actually sent;
  - that leaky drafts are refused with nothing saved (preview, reasoning, key factors);
  - that clean drafts are saved;
  - that every published prediction is byte-for-byte unchanged.

  Mutation probes that remove either gate fail it.
