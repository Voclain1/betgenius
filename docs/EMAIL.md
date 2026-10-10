# Email to subscribers

Operational notes for whoever runs BetGenius email. Code lives in
`src/lib/mail/`; the admin page is `/admin/emails`.

## What goes out

| Email | When | Can be switched off? |
| --- | --- | --- |
| Payment receipt | A payment unlocks VIP/Premium (read from the payment ledger, so webhook, return-from-Paystack and admin reconcile all count) | No: it is about the account |
| Payment problem | 45 min after one of our checkouts is declined, blocked by Paystack, or left unfinished, unless the person has paid since or already has access. One per person per Lagos day, and no more than one every 3 days | No |
| Renewal reminder | 3 days before paid access ends (nothing renews automatically) | No |
| Access ended | Within a day after access ends | No |
| Daily picks | Once a Lagos day, from 09:00 to 20:00, to active subscribers, on days with upcoming VIP/Premium picks. Premium gets Premium and VIP picks | Yes |
| Announcement | Written and sent from `/admin/emails` to paid audiences only | Yes |
| Admin alert | To every admin, when Paystack shows a paid BetGenius checkout that has unlocked nothing after 30 min | Admins only |

Free accounts get account emails only (password reset). They are not an
announcement audience, because they never agreed to marketing email.

## How it runs

Every email is first a row in `EmailMessage` (the outbox), with a unique `key`
naming what it is about, e.g. `receipt:<reference>` or
`daily-picks:<userId>:<date>`. A job that runs repeatedly can therefore never
send the same email twice.

The work runs inside the existing notifications dispatch cron
(`/api/admin/notifications/dispatch`, every 2 minutes), after push
notifications. It is recorded as its own job, `email-dispatch`, on
`/admin/jobs`. Each pass:

1. Once an hour, lists recent Paystack transactions **read-only**
   (`paystack-sync` job). Paystack only sends webhooks for successful payments,
   so this is the only way a declined or abandoned checkout is seen at all. It
   also keeps `/admin/payments` current without pressing Reconcile. It never
   grants, retries or charges anything.
2. Queues whatever is owed (the table above).
3. Sends what is due: up to ~20 seconds per pass, spaced for Resend's rate
   limit, with retries after 2, 4, 8 and 16 minutes, and then `FAILED` with the
   reason.

Emails that go stale are dropped instead of sent late. Each one has an
`expiresAt`: yesterday's picks are never sent, and a reminder is never sent
after its period has already ended.

## Turning it on

- `RESEND_API_KEY` must be set in Vercel (Production). **Without it nothing
  is queued or sent**, so a backlog cannot build up and then go out stale.
- `RESEND_FROM` should be an address on a domain verified in Resend, e.g.
  `BetGenius <hello@betgenius.ng>`.
- `NEXT_PUBLIC_CONTACT_EMAIL`, when set, becomes the reply-to address. Payment
  emails then say "reply to this email". When it is unset, they point to the
  Contact page instead.
- Resend's free plan allows 100 emails a day. Daily picks alone use one per
  active subscriber per day, so move to a paid plan before the subscriber
  count approaches that.

## Unsubscribing

The optional emails carry a signed link (`/email/unsubscribe?t=…`) that works
without signing in. Opening the page changes nothing; the button does. Mail
providers open links to scan them, so a page that unsubscribed on load would
unsubscribe people who never clicked. Mail apps' own Unsubscribe buttons
work too, through the RFC 8058 `List-Unsubscribe` headers. Preferences are
also on `/notifications`. The preference is re-checked when each email is
sent, so an unsubscribe always wins over an email already queued.

## Schema

`EmailPreference`, `EmailMessage` and `EmailCampaign` are new tables, and no
existing table or column changed. Push them with the **db-push** workflow
(Actions → db-push → Run workflow, on the branch that adds them) before
merging. Otherwise the build's schema-sync check fails, as it should.
