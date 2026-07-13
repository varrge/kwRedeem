# ChatGPT checkout browser automation

Status: Draft

## Context

KaWang needs a controlled browser workflow for purchasing ChatGPT Plus or Pro with an eligible SpaceX Card. Card data is obtained from the SpaceX Card Open API. Each target ChatGPT account supplies a legitimately obtained session and runs in an isolated browser profile.

The first delivery stops before the final checkout submission. It selects an eligible card, opens the billing flow, and fills the card and billing-address fields for operator review.

## Proposed flow

1. Create or open one persistent browser profile for the target account.
2. Import and validate that account's session without writing session secrets to ordinary logs.
3. Open the ChatGPT billing page and select Plus or Pro.
4. Fetch candidate cards from SpaceX Card, then fetch real-time details for candidates.
5. Exclude cards that fail the configured eligibility policy and atomically reserve one card for the task.
6. Fill the payment form and stop before the final submission.
7. Present the selected card in masked form and wait for operator confirmation.
8. Release or retain the card reservation according to the operator outcome.

## Safety and reliability boundaries

- SpaceX Card API credentials, full PAN, CVV, billing address, and imported sessions are secrets and must not appear in source control or ordinary logs.
- Browser profiles are isolated per ChatGPT account and must not be shared concurrently.
- CAPTCHA, 3DS, SMS verification, and other security challenges are explicit human-handoff states. The automation will detect and pause; it will not bypass or disguise automation to evade those controls.
- Linux-hosted browsers may be used for repeatable deployment, but browser-fingerprint spoofing is outside this design.
- The initial version does not click the final purchase button.
- Card reservation and task idempotency are required before batch execution.

## Decisions still required

- Session import format and lifecycle.
- Deployment environment and whether a visible browser/VNC is available.
- Exact SpaceX Card eligibility rules and scoring order.
- Plus and Pro expected charge amounts and balance buffer.
- Card reuse, decline cooldown, and concurrency limits.
- Handling of incomplete billing addresses.
- Batch input format and operator review interface.
- Definition of success once final submission is enabled.

