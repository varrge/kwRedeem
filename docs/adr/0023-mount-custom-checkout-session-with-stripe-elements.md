---
status: accepted
---

# Mount custom Checkout Sessions with Stripe Elements

ChatGPT's authenticated payments endpoint can return either a hosted Checkout URL or a
`custom_checkout_session`. The custom response contains a Stripe publishable key and Checkout
Session client secret, while its `checkout_session_id` is not itself a hosted URL. Converting that
ID into `chatgpt.com/checkout/openai_llc/{id}` adds a second ChatGPT page-route authentication
check. A Session that already authenticated `/api/auth/session` and created checkout successfully
can therefore be redirected to login before Stripe is rendered.

The Python payment executor now treats the two response tags as different entry protocols.
Hosted responses retain the existing destination allowlist and navigate to the returned URL.
Custom responses remain on the already authenticated ChatGPT origin: the executor keeps the
publishable key and client secret only in page memory, loads Stripe.js directly from
`js.stripe.com`, initializes the Checkout Elements SDK with the client secret, and mounts the
Payment Element without opening a ChatGPT checkout-session route.

The checkout request fixes the requested plan and billing context locally. A custom response is
not required to echo `billing_details`, `checkout_ui_mode`, or `plan_name`; those request fields are
not response evidence. The executor instead validates the response tag, processor entity, Checkout
Session identifier class, publishable-key class, and client-secret class before retaining material
in page memory. Later Stripe Session inspection remains authoritative for the returned currency and
amount.

Before the mounted surface is eligible for preflight or payment, the executor reads the Stripe
Checkout Session through `loadActions()`. It derives the PHP major-unit amount from
`total.total.minorUnitsAmount` and `minorUnitsAmountDivisor`, then exposes only the reviewed plan,
PH/PHP context, amount, field presence, and control identity to the existing page-fact validator.
The publishable key, client secret, Checkout Session ID, raw Session object, and page contents do
not enter Python results, URLs, logs, SQLite, or Go protocol payloads.

The mounted submit control calls Stripe `confirm()` only after the existing Go permit has been
prepared and activated. No-charge preflight can recognize the Payment Element but never receives
card material or activates that control. A missing custom response field, unsupported Stripe.js
surface, invalid Session currency or amount, CSP failure, or SDK contract drift fails closed before
the money boundary. This decision does not change upgrade-stage navigation, rollout gates, card
reservation, reconciliation, or the hosted Checkout path.
