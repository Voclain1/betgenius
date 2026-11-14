# Screenshot evidence

Captured from the local production build at 390px and 1440px. Files labeled LOCAL QA use the real app with a disposable synthetic preview database. Confirmation images explicitly say LOCAL COMPONENT QA: the real component and production stylesheet render with mocked verification and session adapters; these are not completed payments or proof of live provider behavior.

| Changed flow | 390px | 1440px |
|---|---|---|
| Plans and selected-plan entry | [Pricing](390-pricing.png) | [Pricing](1440-pricing.png) |
| Login return continuity | [Login](390-login.png) | [Login](1440-login.png) |
| Registration return continuity | [Registration](390-register.png) | [Registration](1440-register.png) |
| Correct Korapay failure label | [Component](390-confirmation-korapay-failed.png) | [Component](1440-confirmation-korapay-failed.png) |
| Correct Flutterwave failure label | [Component](390-confirmation-flutterwave-failed.png) | [Component](1440-confirmation-flutterwave-failed.png) |
| Paystack regression comparison | [Component](390-confirmation-paystack-failed.png) | [Component](1440-confirmation-paystack-failed.png) |

The established layout, prices, category order and brand styling are retained. Auth screenshots show accessible form controls; return continuity is demonstrated by browser URL/session assertions rather than a cosmetic change. Confirmation copy now names the fixed provider branch that actually handles verification. No visual or editorial approval is claimed.

The browser sweep also captures homepage, predictions index, Goals category, match and history at both widths; CI uploads those and the existing Sprint 08/09 screenshots as an artifact. All four required widths (320/390/768/1440) receive HTTP and overflow assertions. No screenshot contains a real customer's data, real payment reference or live football performance claim.
