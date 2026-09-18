# Payments: reading the attempt log

Operational notes for `/admin/payments`. Written for whoever is on the hook
when a customer says they cannot pay.

## Why this exists

Paystack only sends a webhook for **successful** charges. An abandoned or
fraud-blocked attempt produced no webhook, no callback and no row on our side,
so the only way to answer "is anybody able to pay?" was to log into Paystack
and read the transaction list by eye. That was tolerable when subscriptions
worked. It stopped being tolerable when checkout broke completely and we had no
internal record of it.

## What a category means, and who has to act

| Category | What happened | Who acts |
| --- | --- | --- |
| `SUCCESS` | Charge approved, entitlement granted | nobody |
| `ABANDONED` | Checkout opened, payer left. **Nothing was charged.** | nobody |
| `FRAUD_BLOCK` | Paystack's fraud system refused it | **us**, with Paystack support |
| `ISSUER_DECLINE` | The payer's bank or card issuer refused it | the payer, via their bank |
| `INSUFFICIENT_FUNDS` | Not enough available on the account | the payer |
| `GATEWAY_FAILURE` | Paystack or the upstream processor failed | nobody; usually transient |
| `PENDING` | A transfer or USSD confirmation not yet settled | wait |
| `UNKNOWN_FAILURE` (shown as "Unclassified") | A failure with no mapping yet | add a mapping |

The distinction that matters most is `FRAUD_BLOCK` versus `ISSUER_DECLINE`.
Both read as "failed" in Paystack. The first is an account-level problem only we
can raise; the second is between the payer and their bank, and there is nothing
we can do about it. Telling a customer to call their bank when our own fraud
configuration refused the charge wastes everyone's time.

`UNKNOWN_FAILURE` appearing is a prompt to add the response string to
`src/lib/paystack/failureCategory.ts`. It is deliberately not a catch-all
bucket — an unmapped failure stays visible rather than being filed under the
nearest-looking category, because a confidently wrong category is worse than an
honest gap.

## Abandoned is not a failure

It is by far the most common outcome and usually means nothing is wrong:
someone opened checkout to look at the price. Do not read a pile of
`ABANDONED` rows as a broken payment flow. Read `FRAUD_BLOCK`,
`GATEWAY_FAILURE` and `UNKNOWN_FAILURE` for that.

## Reconcile

**"Reconcile from Paystack" does not retry, re-charge or re-initialize
anything.** It lists recent transactions read-only and records what it finds.

It is needed because abandoned attempts generate no webhook, and the payer
never returns to trigger the callback — so without pulling the list, the single
most common outcome would be permanently invisible. Run it when you want the
log brought up to date; it is safe to run repeatedly, since attempts are keyed
on their reference and a later observation simply overwrites an earlier one.

## What is never stored

Only these fields are extracted from a transaction: reference, userId, tier,
channel, status, category, gateway response, amount, currency and timestamp.

The `authorization` object (authorization code, card BIN, last4, expiry,
signature), the `access_code`, the customer code, the payer's phone number, and
the session `log` are **never read**, so they cannot reach the database by
accident. `scripts/check-payment-observability.ts` hands the extractor a full
payload containing all of them and asserts that none survives — by scanning the
output, not by trusting the field list, so widening the allowlist without
thinking fails the build.

Emails are shown in the admin table but are **not** stored on the attempt row;
they are resolved from `userId` at read time.

## Channels

The per-channel paid/not breakdown is evidence for a future decision about
which channels to offer. It is not a reason to change the channel configuration
on a small sample. As of this writing no channel has completed a subscription
payment on the live account, and the one-time fallback is what is being
measured.

## Schema

`PaymentAttempt` is a standalone table with no relations to existing models.
It is append-mostly, upserted on `reference`, and nothing reads it except the
admin view — so it cannot affect entitlement, pricing or access in any way.
