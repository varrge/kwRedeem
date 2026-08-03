# Go-controlled membership checkout

Status: Accepted — browser runtime amended by [ADR-0008](./0008-private-virtual-display-checkout.md); controlled production validation pending.

## Context

The protected Session already submitted with an order contains the ChatGPT `sessionToken`, expiry and account identity required to establish a browser session. Go can locally create the NextAuth Cookie chunks without sending the Session to a checkout broker. SpaceXCard remains the source of full card material through OpenAPI, transaction history, and Webhook events; kwRedeem remains the billing-address source. Requiring either a separately installed browser extension or a SpaceXCard GPT Broker Token adds authentication and failure surfaces without owning unique business capability.

## Decision

The independent `kwMembership` Go worker owns the production membership workflow and directly reads/writes kwRedeem's SQLite/WAL database. It starts a fresh isolated unattended Chrome context for each checkout and locally chunks the current order's `sessionToken` into allowlisted ChatGPT cookies. Inside that authenticated context it verifies the account email, reads the official current subscription with the Session-derived access token and stops when a paid subscription is still active. Otherwise it posts the extension-proven fixed Plus request (`billing_details.country=PH`, `billing_details.currency=PHP`, `checkout_ui_mode=hosted`, `entry_point=all_plans_pricing_modal`) to the official `/backend-api/payments/checkout` endpoint and accepts only an allowlisted hosted URL or the exact `openai_llc/{oaics_*,cs_*}` custom-session response before applying the existing checkout-surface contract. It never calls `/subscriptions/renew` during preflight. The same Session-driven entry is rebuilt for final Plus payment execution, while upgrade execution reuses the locally generated Cookies. No GPT Broker Token, SpaceXCard `/api/v1/gpt/*` call, extension installation, extension token, bound installation, visible-browser operator step, Node task dispatch, or membership callback is required.

The checkout module presents one `Execute` interface. Its Chrome adapter hides frame discovery, allowlisted page recognition, field filling, control activation, and cleanup. The processor supplies an internal action-guard adapter: every progression or final control activation first persists a single-use permit and snapshots the selected card's authorization identities. A final permit advances the durable state before the click, so a crash or lost response can reconcile but cannot resubmit blindly.

The existing rollout rules remain fail-closed:

- Payment Gate defaults disabled.
- The new adapter version is `go-session-api-checkout-v2`; `go-session-cookie-v1`, `go-headless-v1`, and extension-era `checkout-v1` qualifications and automatic scopes do not authorize it.
- No-charge preflight requests no card material and activates no money-bearing control; creating an unused checkout session does not authorize funding or payment.
- Canary and automatic authorization are rechecked immediately before every possibly money-bearing control.
- CAPTCHA, 3DS, SMS, and bank challenges stop automation and create an intervention; the worker does not bypass them.
- Session, Cookie values, PAN, CVV, Checkout URLs, tokens, and raw provider bodies never enter ordinary logs or audit details.

## Controlled preflight challenge experiment

The production rendering runtime is defined by ADR-0008. A structurally recognized Cloudflare challenge remains a separate intervention: the worker records `CHECKOUT_CHALLENGE_WAIT`; an administrator may reach the localhost-only noVNC service through an SSH tunnel and complete the challenge in that retained window. The worker proceeds only after the normal adapter independently recognizes the allowlisted checkout surface.

This exception is limited to the pre-funding, no-card-material preflight. It does not spoof a browser fingerprint, solve or bypass the challenge, expose VNC publicly, activate a checkout control, authorize payment, or change the Canary approval boundary. Payment-stage CAPTCHA, 3DS, SMS, and bank challenges continue to stop automation under the normal intervention rules.

## Passwordless interactive-login preflight experiment

An explicitly selected fulfillment may use `CHECKOUT_LOGIN_READY` instead of the ordinary Session-driven preflight. The Go checkout module opens a fresh visible `chatgpt.com` window backed by a private temporary Chrome profile and records `CHECKOUT_LOGIN_WAIT`. An administrator reaches the localhost-only noVNC service through an SSH tunnel, signs in directly, and manually navigates to the initial Plus checkout page. The application never asks for, receives, persists, logs, or replays the password, MFA code, passkey, or resulting Cookie payload.

While the page remains on `chatgpt.com`, the Chrome adapter requests the current authenticated session inside that same browser context and returns only the normalized account email to Go memory. Go compares it with the protected order identity and discards it; a mismatch or unverifiable identity fails closed. The adapter then applies the ordinary allowlisted Plus/PH/PHP price and page-structure checks without card material or control activation.

This experiment deliberately stops at `CHECKOUT_LOGIN_PREFLIGHT_PASSED`, not `FUNDING_READY`. The isolated browser is destroyed after the result and no authenticated browser material is persisted across stages. It remains only a diagnostic fallback. Production execution instead rebuilds an isolated authenticated context from the protected order Session for each stage, without storing customer passwords or weakening the existing identity, permit, and payment gates.

## Consequences

Production needs Chrome or Chromium installed on the worker host. `kwmembership-worker --check` launches an isolated `about:blank` process in the configured browser mode to validate the binary and sandbox without contacting an external provider or claiming work. The old extension endpoints and tables may remain temporarily for compatibility and historical evidence, but the Go production path does not call them and new fulfillment states use `CHECKOUT_PREFLIGHT_READY` and `CHECKOUT_EXECUTION_WAIT` instead of `BROWSER_LEASE_WAIT`. The passwordless interactive-login state is an explicit no-charge experiment and is not a production checkout path.

Database initialization persists a Go Intake watermark. Automatic discovery accepts only membership orders created at or after that watermark, so deploying the worker cannot silently replay the historical order backlog; older orders require the existing explicit, audited single-order backfill path.
