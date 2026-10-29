# Prediction quality and competitor review

## System-wide stage defect

The public Juventus–Rennes page for 22 October describes the fixture as a knockout tie while its fixture panel says League Stage - 3. This is a confirmed internal contradiction. It does not prove every statistic on that page is incorrect.

The shared model system prompt in src/lib/ai/analysis.ts instructed every CUP fixture to be analysed as a knockout tie. The digest explicitly carries competitionType and round, but CUP includes competitions with league/group phases. This is a system-wide generation risk, not an isolated template typo. Code callers confirmed: ordinary generation, draft rewrites and the Goals pipeline use generatePredictionForFixture. Gemini/Groq both use that shared function. No complete historical database scan was performed, so the number of affected published fixtures remains unknown.

## Forward fix

Correct the shared prompt: competition type is not stage; use supplied round evidence; league/group phases can use their supplied competition standings; unknown stages must not gain invented knockout/qualification stakes. Add a shared post-completion guard, before callers receive the output for persistence, scanning previews, key factors and prediction reasoning for explicit knockout tie/match/clash/encounter wording. The guard permits it only for recognised knockout rounds. Unknown stages fail closed for those claims. A failure rejects the output rather than editing an argument whose premise may be wrong. It can conservatively reject historical knockout references too; this is a known precision limitation, and the scanner does not certify arbitrary football facts or catch every paraphrase.

No published previews, picks, scores or outcomes are automatically rewritten. Existing contradictions need a separate source-data review. In particular, do not regenerate old predictions using current form and present them as original pre-match reasoning. No database mutation, schema change or provider generation is included in this batch.

## Competitor sample

Read directly on 29 October: PredictZ daily index and Everton–Newcastle match page; FootballPredictions.com daily index and Frosinone–Lecce page; SportyTrader daily index and Everton–Newcastle page. These are established search competitors from the earlier stored keyword report, not a newly measured ranking order. Forebet returned HTTP 403 and is excluded from feature conclusions. This is a focused sample, not a full feature audit or verification of competitors' prediction accuracy.

| Observed feature | Competitor evidence | BetGenius assessment and action |
|---|---|---|
| Inspectable recent-results history | PredictZ shows dated recent results and home/away form. SportyTrader shows all/home/away result rows. | MatchFormComparison currently reduces cached history to a rating and last-five aggregate. Add a compact dated result list using the existing cache; show the competition and sample window. High priority. |
| Publication/update clarity | SportyTrader displays publication and modification timestamps beside attribution. FootballPredictions.com has a dated author block. | BetGenius has organization attribution and a publication note, but stored analysis and refreshed context are mixed. Separate prediction publication time, evidence refresh time and any correction time; do not imply a human review that did not happen. High priority. |
| Section navigation | FootballPredictions.com exposes links for prediction, lineups, injuries and stats. | Add short anchor navigation only for sections actually rendered on BetGenius. Helps long/mobile pages; no unsupported sections. High priority, separate UI batch. |
| Market and bookmaker comparison | PredictZ exposes several market prices; SportyTrader shows a 1X2 bookmaker comparison and opening/pre-match changes. | BetGenius has bookmaker-backed accumulator prices but the sampled match page does not expose an equivalent timestamped comparison. Validate stored odds coverage, timestamps, bookmaker relevance and quota budget before adding it. Medium priority. Never invent opening prices. |
| Confirmed lineups | FootballPredictions.com labels its starting XI confirmed and separates substitutes. | BetGenius's team-news and key-player modules are not equivalent to confirmed lineups. Add only when a supported fixture cache supplies confirmed lineups, with clear unavailable states. Medium priority, data-dependent. |
| Broad discovery | Competitor indices expose date/league/market routes; PredictZ offers odds format preferences. | BetGenius already has day tabs, markets, league/team/H2H pages and detailed/compact views. Improve discovery and filtering around existing routes before creating more thin URLs. Odds-format preference is lower priority than accuracy/freshness. |
| Attribution and trust | Competitors show named contributors or expert framing. | Retain truthful Editorial Desk attribution unless real accountable reviewers are appointed. Do not invent experts, headshots, credentials or prediction accuracy. |

## What to preserve

BetGenius already offers verdicts, previews, key factors, team news, statistical comparisons, H2H context, tables, public performance records and contextual links. These are not missing simply because a competitor presents them differently. Its result-record and methodology transparency are useful differentiators. Clear sampled status/availability and contradiction prevention matter more than more copy. Do not copy unsupported probability displays: a model confidence score is not a demonstrated calibrated probability. Do not adopt aggressive affiliate clutter, guaranteed-profit claims or gamification just because a competitor has them.

## Ordered next work

1. Ship and verify the shared stage fix. Review the known historical contradiction against its original stored digest before any correction.
2. Add dated recent-results evidence using existing caches and explicit refresh labels, keeping original analysis separate from current data.
3. Add conditional section navigation and a transparent evidence-availability summary, with mobile visual QA.
4. Assess confirmed-lineup and timestamped match-odds coverage; build only where the available data can support the promise.
5. Measure relevant non-brand clicks and engagement after deployment. Feature presence is not proof of ranking causality, and this review predicts no numerical uplift.

## Sources

- https://www.betgenius.ng/predictions/match/juventus-vs-rennes-2026-10-22
- https://www.predictz.com/
- https://www.predictz.com/predictions/england/efl-cup/1223060/
- https://footballpredictions.com/footballpredictions/
- https://footballpredictions.com/footballpredictions/serieapredictions/frosinone-vs-lecce-prediction-29-10-2026/
- https://www.sportytrader.com/en/betting-tips/football/today/
- https://www.sportytrader.com/en/betting-tips/everton-newcastle-383049/

Validation: offline competition-stage checks and 49 provider-chain checks passed; 203 existing SEO checks passed; TypeScript passed. New guard tests include league/group phases, preview/reasoning/key-factor rejection, legitimate quarter-final wording and unsupported unknown-stage wording. CI runs the new check. No live model completion or production database audit was performed.
