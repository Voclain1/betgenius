# Production evidence boundary

No production secrets, prices, provider activation, schedules, database writes or deployment actions were performed.

- Read-only repository inspection: master `5c6998f`, PR #195 merged. #193 and #194 remain separate/open; scope ownership is in the matrix.
- Latest visible deployment run: 43631844870, commit `5c6998f572d937aa6436eaa6700c975908cc25f0`. The workflow and its Build/push and Ship/switch steps report success. This is workflow evidence, not an independently verified currently served image identifier.
- Public read-only samples: [raw sanitized results](public-probes.json). Health returned 200/ok with no-store; robots and sitemap index use the canonical www host; pricing returned 200 with the expected self-canonical. Only these URLs were sampled; this does not validate every landing page or Google-selected canonical.
- GitHub secret/variable metadata requests returned HTTP 403, Resource not accessible by integration. Values were not requested or printed. Presence, consistency, live provider capabilities and current webhook configuration cannot be attested.
- Windsor discovery found the BetGenius GA4 property and Search Console domain. Both report reads were rejected because account count exceeds the free plan limit. No data rows were supplied. No current MAU, returning-user, organic-search or revenue figures are reported. No accounts were disconnected, subscription changed or tracking settings modified. The old September Search Console document is dated historical evidence only.
- No live checkout, charge, webhook replay, reconcile, manual-payment approval or production cron endpoint was invoked. Those could cause financial or publishing changes and are outside this unapproved release exercise.

## Exact post-approval evidence still required

1. Operator verifies the served image tag/SHA and environment names against the approved deployment record; confirms auth origin, enabled payment methods, public analytics settings, webhook URL/signature configuration and cron/ops secrets without publishing values.
2. For each enabled payment method, perform an authorized sandbox or approved small live transaction for VIP/Premium. Capture redacted provider reference, correct amount/currency/tier/account binding, exactly one entitlement grant, expected period end, paid access and receipt. Redeliver the signed test notification and confirm no extra period. Check cancellation/pending/failure without accidental activation. Never publish references, email addresses, keys or payer details in the PR.
3. Inspect recent JobRun/publication/settlement and scheduler exit records, provider failures/quota use, overdue pending matches and publication evidence. Require a measured observation window (at least 24 hours covering every scheduled job), not a health ping or synthetic test alone.
4. Verify backup freshness, most recent isolated restore test, approved rollback image availability, and reversible deployment procedure with the operator. A prior successful build is not a restore test.
5. Restore authorized GA4/Search Console report access through an owner-selected account/plan decision. Export a dated full-month baseline with timezone, completeness and consent limitations; inspect index coverage, submitted sitemaps and a small URL sample in Search Console. Current search traffic/indexing remains unverified until then.
6. Review #193’s confirmed finder corrections and decide its separate merge/deployment order or explicitly accept the known limitations. This consolidation neither includes nor approves it. #194 research infrastructure remains outside product release and cannot activate a model.

**Release/workstream closure recommendation: BLOCKED** until the production checks and independent finder dependency above have explicit evidence or an owner-documented acceptance decision. Engineering fixes can be reviewed separately; green synthetic CI is not production reliability certification.
