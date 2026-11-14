# Business measurement using existing sources

No new tracking service, identity, schema or personal-data collection is proposed. Report calendar months in Africa/Lagos, show the extraction date, and compare complete periods. Consent, ad blockers and provider reporting delays limit analytics coverage. Payment and subscription records remain the source of truth for paid access.

| Measure | Existing source and definition | Reporting discipline |
|---|---|---|
| Monthly active users | GA4 active users over the complete calendar month | Query the whole month; do not sum daily unique users. Show consent coverage limitations. |
| Organic discovery | Search Console clicks and impressions for `sc-domain:betgenius.ng`; split by landing page and device where available | Same complete date windows, acknowledging reporting lag. Impressions are not visitors; do not infer indexing completeness from sitemap inclusion. |
| Returning visitors | GA4 returning-user definition/dimension over the same month | Use the service's returning metric, not total minus new users across incompatible windows. No claim about visitors who did not consent. |
| Free-to-paid conversion | Existing signup and first successful entitlement grant; aggregate registered cohorts with a stated observation window | First paying accounts / eligible signup cohort; separate repeat renewals. GA4 sign_up/begin_checkout/purchase are funnel diagnostics, not the financial ledger. No export of emails/names. |
| Successful payments | Unique verified PaymentAttempt references with entitlement granted; reconcile manual approvals and provider records | Do not count an unverified callback, raw redirect or repeated webhook as a payment. Count provider failures/pending separately. |
| Paid subscriptions | Subscription state and currentPeriodEnd after the reporting instant | Count unexpired active paid accounts by tier; distinguish new grants, renewals and expiries. Do not sum payment attempts as subscribers. |
| Revenue | Verified payment records, provider reconciliation and actual amount/currency | Keep NGN and USDT totals separate; no invented exchange rate. State refunds/chargebacks/fees and manual-payment reconciliation coverage. Checkout events are intent, not revenue. |
| Publishing reliability | Existing JobRun and publication records compared with the configured expected schedules/category requirements | Report expected runs, completed runs, failures, late/no-publication runs and gaps. A successful job log alone does not prove a useful, fresh public feed. Pair with read-only freshness checks and investigate missed denominators. |

## Availability and targets

**No current business metrics were obtained in this sprint.** The connected service listed the BetGenius GA4 and Search Console accounts, but both report requests returned its Free-plan account limit (12 accounts connected; limit 1). Account removal or an upgrade is an owner decision; neither was performed. Repository secret/variable metadata was also inaccessible (403). No zeroes, growth percentages or conversion estimates have been substituted.

After access is restored, the owner should export one complete baseline month and the comparable previous month, reconcile financial totals, then choose targets. Targets must be labeled targets; synthetic browser fixtures and estimated prediction returns must never become business revenue or traffic observations. Existing client purchase events deduplicate by transaction ID; blocked storage can permit a repeat across separate page loads, so the verified ledger remains authoritative.
