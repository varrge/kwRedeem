---
status: accepted
---

# Retain a private order browser context across checkout stages

Some imported ChatGPT Sessions authenticate `/api/auth/session` but are redirected back to login when a hosted checkout route is opened. Custom Checkout Sessions avoid that second route through ADR-0023, but hosted responses and other authenticated ChatGPT surfaces can still require a device login. Reinjecting only the NextAuth Session Cookie into another fresh profile does not preserve the device, risk, and browser state established by a login in the checkout network environment.

For explicitly enabled deployments, a Session preflight may therefore hand the existing visible Chromium window to an administrator through the localhost-only noVNC service when checkout redirects to login. The administrator enters credentials directly into ChatGPT. kwRedeem and kwMembership never receive, persist, or log the password, MFA code, passkey, resulting Cookie values, checkout URL, or page contents. Python verifies the resulting account email against the fulfillment identity and recreates checkout in the same Context and proxy environment.

When the external membership-status provider returns an order-scoped `401` before Chromium starts, the same explicit flag may route the fulfillment to this read-only browser preflight instead of cancelling it immediately. This exception requires visible-browser mode and does not reserve a card or establish a money boundary. The browser checkout contract remains responsible for rejecting an already-subscribed account before funding begins.

A successful preflight may retain its Chromium user-data directory for later stages of the same fulfillment. The directory lives under a systemd-owned `0700` runtime directory, is bound to an allowlisted fulfillment ID and a SHA-256 digest of the effective proxy configuration, and is never shared between fulfillments. A changed proxy or binding discards the profile. A final stage, any failed execution, or a two-hour inactivity limit discards it; service shutdown also removes the runtime directory. Card material remains memory-only and is never written by kwMembership to the profile or its binding metadata.

This capability is disabled by default. It does not change the global serial queue, five-minute execution deadline, payment Gate, Canary authorization, action Permit, money boundary, or evidence-based reconciliation rules. `preflight` mode still rejects payment commands at the process boundary. It narrows the exception in ADR-0020 that required every successful preflight profile to be destroyed, while preserving its isolation and workflow-ownership decisions.
