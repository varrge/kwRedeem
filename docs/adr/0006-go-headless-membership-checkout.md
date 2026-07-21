# Go headless membership checkout

Status: Accepted — implementation complete; controlled production validation pending.

## Context

SpaceXCard already exposes the server-side inputs required by membership fulfillment: a Session-derived one-time Checkout URL, Session-to-Cookie conversion, full card material through OpenAPI, transaction history, and Webhook events. kwRedeem also exposes the billing-address source. Requiring a separately installed and bound browser extension added another process, token, queue, lease, and failure surface without owning unique business capability.

## Decision

The independent `kwMembership` Go worker owns the production membership workflow and directly reads/writes kwRedeem's SQLite/WAL database. It starts a fresh isolated headless Chrome context for each checkout and injects only the current order's allowlisted ChatGPT cookies. No extension installation, extension token, bound installation, visible browser, Node task dispatch, or membership callback is required.

The checkout module presents one `Execute` interface. Its Chrome adapter hides frame discovery, allowlisted page recognition, field filling, control activation, and cleanup. The processor supplies an internal action-guard adapter: every progression or final control activation first persists a single-use permit and snapshots the selected card's authorization identities. A final permit advances the durable state before the click, so a crash or lost response can reconcile but cannot resubmit blindly.

The existing rollout rules remain fail-closed:

- Payment Gate defaults disabled.
- The new adapter version is `go-headless-v1`; extension-era `checkout-v1` qualifications and automatic scopes do not authorize it.
- No-charge preflight requests no card material and activates no control.
- Canary and automatic authorization are rechecked immediately before every possibly money-bearing control.
- CAPTCHA, 3DS, SMS, and bank challenges stop automation and create an intervention; the worker does not bypass them.
- Session, Cookie values, PAN, CVV, Checkout URLs, tokens, and raw provider bodies never enter ordinary logs or audit details.

## Consequences

Production needs Chrome or Chromium installed on the worker host. `kwmembership-worker --check` launches an isolated `about:blank` headless process to validate the binary and sandbox without contacting an external provider or claiming work. The old extension endpoints and tables may remain temporarily for compatibility and historical evidence, but the Go production path does not call them and new fulfillment states use `CHECKOUT_PREFLIGHT_READY` and `CHECKOUT_EXECUTION_WAIT` instead of `BROWSER_LEASE_WAIT`.
