# Ways to pay

Customers choose how to pay on `/pricing`. Every method buys the same 30 days
at the price in `src/lib/pricing.ts`, and every one unlocks access through the
same exactly-once grant, so receipts, renewal reminders and the admin views
work the same whichever was used.

| Method | Switched on by (Vercel env) | Confirmed by |
| --- | --- | --- |
| Paystack | `PAYSTACK_SECRET_KEY` | Paystack, automatically (unchanged: `src/lib/paystack/`) |
| Korapay | `KORAPAY_SECRET_KEY` | Korapay, automatically |
| Flutterwave | `FLUTTERWAVE_SECRET_KEY` **and** `FLUTTERWAVE_SECRET_HASH` | Flutterwave, automatically |
| Bank transfer | `BANK_TRANSFER_BANK_NAME`, `BANK_TRANSFER_ACCOUNT_NUMBER`, `BANK_TRANSFER_ACCOUNT_NAME` | An admin, by hand |
| USDT | `USDT_WALLET_ADDRESS` (`USDT_NETWORK`, default `TRC20`) | An admin, by hand |

A method appears only when all of its settings exist, so adding or removing one
is a Vercel change plus a redeploy, no code. With only Paystack on, the pricing
page goes straight to Paystack as it always has.

## Korapay

1. In the Korapay dashboard (Settings → API Configuration), copy the **live
   secret key** into `KORAPAY_SECRET_KEY` in Vercel (Production).
2. Redeploy. The Korapay option appears on `/pricing`.

Nothing else to set: every checkout tells Korapay where to send its webhook
(`/api/payments/korapay/webhook`), and the webhook is signed with the same
secret key. Customers can pay by card or by bank transfer to a one-time
account number Korapay creates for that payment, so they never see a personal
account name, and the transfer is confirmed automatically.

Starting a checkout records the reference against the customer's account
(Korapay's charge record does not include the payer's email). Access is granted
only from Korapay's own charge lookup, fetched by our server, and only when it
is `success`, in NGN, exactly the plan's price, for that `kp_<TIER>_…`
reference. The return page and the webhook can both see a payment; it is
applied once.

Before relying on it, confirm with Korapay that a betting-tips subscription is
an approved business category for your account.

## Flutterwave

1. In the Flutterwave dashboard (Settings → API keys), copy the **live secret
   key** into `FLUTTERWAVE_SECRET_KEY`.
2. In Settings → Webhooks, set the URL to
   `https://<your domain>/api/payments/flutterwave/webhook`, choose a secret
   hash (any long random string), and put the same string in
   `FLUTTERWAVE_SECRET_HASH`.
3. Redeploy. The Flutterwave option appears on `/pricing`.

Access is granted only from Flutterwave's own verify response, fetched by our
server, and only when it is `successful`, in NGN, exactly the plan's price, for
our `fw_<TIER>_…` reference, paid by the account's own email. The return page
and the webhook can both see a payment; it is applied once.

## Bank transfer and USDT

1. The customer picks the method and lands on `/pay/<id>`, which shows the
   account (or wallet), the exact amount and a code like `BG-7K3Q9A` to put in
   the narration (or memo).
2. After paying they enter the sending account name (or the transaction hash)
   and tap **I've paid**. Every admin gets an email.
3. In **Admin → Bank & USDT**, check the money actually arrived — the exact
   amount with that code in your bank app, or the transaction on the
   blockchain to our wallet on the right network — then **Approve**, which
   unlocks the plan and sends the receipt, or **Reject**, which emails the
   customer the reason. Screenshots can be faked; only your bank app or the
   blockchain is proof.

USDT is priced at the dollar figure in `src/lib/pricing.ts`.

## Records

Every grant writes a `PaymentAttempt` row (with `provider`), so `/admin/payments`
lists Flutterwave and approved manual payments alongside Paystack's. Bank and
USDT requests themselves live in `ManualPayment`.
