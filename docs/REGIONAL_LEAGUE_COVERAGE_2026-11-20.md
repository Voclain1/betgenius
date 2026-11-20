# Regional league coverage and 5-day public calendar — 20 November 2026

## Verified repo findings
1. Saudi Pro League (307) is already in the catalogue and SECONDARY generation. BetGenius has published Saudi predictions, as shown at https://www.betgenius.ng/predictions/league/pro-league-307. Missing current tips is not the same as missing league support; fixture schedule, provider availability, candidate eligibility and quote gate all affect publication. See official fixture schedule https://www.spl.com.sa/en/fixtures-results .
2. Serbia (286), Ukraine (333), Russia (235) and South Africa (288) were catalogued but FALLBACK. On healthy days ordinary discovery deliberately does not generate FALLBACK; this explains their underrepresentation.
3. UAE Pro League (301) and Kuwait Premier League (330) were not in the catalogue or generation scope. Their API-Football v3 IDs were independently checked against public API-Football-ID coverage listings: https://almanac.ctaylor.dev/football/coverage and https://www.api-football.com/coverage/ . Confirm current season/odds flags against the production provider during rollout.
4. The early round-robin cursor did not guarantee a prompt Saudi scan, even though Saudi was in SECONDARY.

## League changes
| Country | V3 ID | Before | After |
|---|---:|---|---|
| Saudi Arabia | 307 | SECONDARY | SECONDARY, regional spotlight |
| UAE | 301 | Not catalogued | Catalogued, SECONDARY, spotlight |
| Kuwait | 330 | Not catalogued | Catalogued, SECONDARY, spotlight |
| South Africa | 288 | FALLBACK | SECONDARY, spotlight |
| Serbia | 286 | FALLBACK | SECONDARY, spotlight |
| Ukraine | 333 | FALLBACK | SECONDARY, spotlight |
| Russia | 235 | FALLBACK | SECONDARY, spotlight |

An extra rotating spotlight slot scans one of these seven leagues every half-hour; the prior three regular CORE/SECONDARY cursor slots are preserved. All seven receive one spotlight scan during each 3.5-hour cycle. No quality bypass: the same senior-team, fixture, confidence, exact bookmaker price, and admin boundaries still apply. Daily queue caps and API quotas still apply.

Discovery records per-league counts of fixtures seen and candidates queued. A league may be correctly scanned but produce zero qualifying predictions; that requires a deeper provider/evidence diagnostic, not fabricated fixtures.

## Admin review and visible calendar
- Early automatic publication only handles its own dedicated early-FREE job drafts, after verifying saved job identity, fixture identity, evidence and quote; unrelated normal/manual drafts never inherit this authority.
- Transactional state claims prevent the same early draft from being published by both the automated system and an admin simultaneously. An admin action that changes its status prevents the automated branch from claiming it. Early generation does count as coverage for the same fixture, so ordinary duplicate generation is intentionally suppressed.
- Public date rail displays Yesterday, Today, Tomorrow and upcoming Days 2–5 only. Date queries continue to support Days 6–14, keeping early-published picks accessible by direct future-date URL and their own league/match pages.

## Remaining verification
- GitHub CI, TypeScript and regression checks on the complete PR head.
- After merge and deployment, inspect actual 2026 provider season, fixture and bookmaker depth in these seven leagues and check discovery job's per-league counters. Do not infer live odds coverage or future prediction frequency from catalogue membership.
- Early free publication flags and deployment stay controlled. Do not change VIP/Premium tier qualification, paid candidate supply or regular admin review.

## Clarification: every major league keeps full-fixture eligibility
The examples EPL and La Liga refer to **all major leagues**, not just those two. The explicit full-fixture exemption in `src/lib/generation/selectiveLeagues.ts` protects all European top-five leagues, Eredivisie, Primeira Liga, Belgian Pro League, Turkish Super Lig, the major Swiss/Austrian/Scottish/Scandinavian/Central European domestic competitions, Brazilian Serie A, NPFL, Argentina, Colombia, Liga MX, MLS, Japan J1, Korea K1 and Egypt's top division. This is an analysis-eligibility exemption, not a publication guarantee; bookmaker/quality requirements still apply.

Strong-club filtering remains only for the seven expressly requested regional leagues, the existing Cyprus/Latvia special cases, and lower-profile FALLBACK/DEEP_FALLBACK domestic `lower`/`minor` leagues. A competition being categorised FALLBACK for provider-cost planning does **not** automatically make all of its fixtures unimportant (e.g. Liga MX, MLS or Argentina).
