# ChatGPT membership fulfillment implementation specification

Status: Accepted design — Phase 4–7 代码实现与模拟验证完成；受控生产验收待执行。

This specification turns [ADR-0005](./adr/0005-chatgpt-checkout-browser-automation.md) into an implementation contract for kwRedeem and the bound GPT Helper extension. It covers Plus, x5, and x20 card inventory, funding, browser checkout, confirmation, renewal protection, operations, and rollout. It does not modify the official `sub2api/` reference checkout or use `sub.vsakura.top` for this workflow.

## 1. Fixed boundaries

- `https://apikey.vsakura.top` remains the kwRedeem API and extension origin.
- The existing Session Activation Delivery stays independent. Its `extension_delivery_status` continues to mean only incognito Cookie installation, verified identity, page refresh, and starting subscription protection.
- A new Membership Fulfillment owns account eligibility, card inventory, capacity reservation, funding, payment stages, reconciliation, target-tier confirmation, and final renewal cancellation.
- One redeem order has at most one Membership Fulfillment. Attempts and operator resumes append history to that aggregate; they never create a replacement aggregate or reset Session Activation Delivery.
- A product has an explicit `membership_tier` of `plus`, `x5`, or `x20`. The order and fulfillment snapshot that value at creation. Titles, prefixes, site slugs, and `manual_type` are not tier authorities.
- The single bound extension and Chrome's shared incognito Cookie Store process one membership order at a time through a durable Browser Fulfillment Lease. Additional incognito windows do not add concurrency.
- SpaceX Card deletion, freezing, automatic refund, and automatic card-balance refund are outside this workflow. “Release” always means release an internal order reservation after proving no payment occurred.
- Full PAN, CVV, expiry, Session, Cookie values, checkout links, tokens, and raw provider responses must never appear in ordinary logs, WebSocket messages, audit details, diagnostic uploads, or browser persistence.
- Production payment capability ships behind a default-off gate. Deployment alone never permits card opening, recharge, or a final payment action.

## 2. Existing baseline and mandatory safety change

The following existing implementation is retained and reused:

- `api/src/extension-delivery.js`: extension authentication/binding, WSS notifications, Session-to-Cookie conversion, incognito identity result, and starting subscription guard.
- `shared/src/session-cookie-converter.js`: fixed Session-to-Cookie adapter.
- `background-kw-delivery.js`: serialized incognito Cookie installation and rollback.
- Existing `requireAdmin`, encrypted settings, audit log, Feishu Webhook, SQLite/WAL, worker process, and US/Delaware address API.
- Existing “商城交付” and “扩展交付” refresh buttons.

The following existing behavior is forbidden for Membership Fulfillment and is the first implementation blocker:

- `background-autofill.js` currently scores arbitrary buttons from text such as “pay”, “continue”, and “upgrade”, then schedules an automatic click after a random delay. Remove that automatic click path before any membership checkout code is enabled.
- The legacy `gptPayJump`/`scheduleCheckoutAutoConfirm` path must not be reachable from the new automation. A manually opened checkout may retain address-fill helpers, but no helper may select or click a progression or final-payment control by text scoring.
- The automated path must not call the extension's locally authenticated SpaceX Card account, read its locally stored SpaceX token, call `/gpt/checkout` from the extension, or use the `usaddressgen.com` fallback.

Until the versioned checkout adapter replaces those behaviors and passes tests, the server must report the adapter as incompatible and keep all real-payment gates closed.

## 3. Provider adapters

All provider calls live behind server-side modules with fixed origins and strict normalized return types. Route handlers, the worker, and the extension must not parse provider envelopes directly.

### 3.1 SpaceX Card GPT adapter

Use the existing encrypted SpaceX Card GPT user token only for these fixed endpoints:

```text
POST https://spacexcard.com/api/v1/gpt/session-to-cookie
POST https://spacexcard.com/api/v1/gpt/check
POST https://spacexcard.com/api/v1/gpt/cancel-renewal
POST https://spacexcard.com/api/v1/gpt/checkout
```

The checkout request uses the order's decrypted Session only in server memory:

```json
{
  "token_input": "<JSON.stringify(sessionObject)>",
  "plan_name": "plus",
  "country": "PH",
  "currency": "PHP"
}
```

Only the resulting one-time checkout URL is returned to the owning extension over authenticated HTTPS with `Cache-Control: no-store`. x5 and x20 never use a direct `prolite` or `pro` checkout request; they upgrade from confirmed Plus through ChatGPT plan management.

Before enabling this adapter, add redacted fixture-backed tests for successful checkout creation, cancellation, authentication failure, throttling, timeout, oversized response, and contract drift. A guessed recursive response parser is forbidden.

### 3.2 SpaceX Card OpenAPI adapter

Use separate encrypted OpenAPI credentials only for the fixed base:

```text
https://spacexcard.com/openapi/v1
```

The adapter owns these operations:

```text
GET  /products
GET  /cards
GET  /cards/{id}
GET  /cards/{id}/transactions
GET  /cards/{id}/openai-payments
GET  /cards/{id}/recharges
POST /cards/open
POST /cards/recharge
GET  /balance
GET  /balance-logs
```

It must not expose wrappers for card refund, freeze/unfreeze, or delete. Every response requires both an acceptable HTTP result and `code === 0`. Read responses are size-bounded and normalized; write operations always carry the persisted `Idempotency-Key`.

`GET /cards` may contain a full card number. The adapter immediately derives only the upstream identifiers, product code, BIN/card segment, last four digits, balance, and status, then discards the full number. `GET /cards/{id}` is the only automated source of PAN/CVV/expiry and may be called only while creating a single-use checkout material response.

### 3.3 Membership State Provider adapter

Only kwRedeem calls:

```http
POST https://gptserve.freespaces.app/api/subscription/info
Content-Type: application/json

{"token": <decrypted Session object>}
```

The extension never receives this Session or calls this provider. The adapter accepts envelope `code === 200` and strictly maps:

```text
free    -> free
plus    -> plus
prolite -> x5
pro     -> x20
```

Missing or unknown `account_type` is `MEMBERSHIP_CONTRACT_UNKNOWN`, never `free`. A strict successful stage observation requires:

```text
expected normalized account type
currency === PHP
is_overdue === false
is_delinquent === false
parseable expire_time in the future
```

Final completion additionally requires `auto_renew === false`. Persist only normalized fields and observation time, never the request, raw response, Session, or provider-specific extra fields.

Starting-account eligibility uses a separate predicate. A known `free` account may have no paid-plan currency or expiry, but still requires a valid envelope, `account_type === free`, and explicit non-delinquent/non-overdue booleans. Those missing paid fields are acceptable only as starting-free evidence; they can never confirm a purchased stage. A known paid account must satisfy the paid-plan fields above before it is classified as healthy, delinquent, or uncertain.

### 3.4 Address adapter

Reuse `/api/public/us-address/generate?count=1&includePerson=true`. Every actual checkout gets a new US/Delaware person and address. Philippines/PHP is the checkout price region, not the billing address country.

An incomplete address produces `CHECKOUT_ADDRESS_UNAVAILABLE`. The automated path does not scrape or fall back to another site. The pre-funding check may validate and discard one generated address; the actual material grant obtains a fresh address. Neither is persisted.

## 4. Runtime architecture

Use the existing SQLite/WAL deployment with short transactions:

- The API owns admin/extension REST routes, the existing authenticated WebSocket, sensitive material responses, and the current in-process socket connection.
- The worker owns inventory reconciliation, fulfillment scheduling, provider polling, funding, renewal recovery, and due-time processing.
- A durable sanitized outbox bridges worker state changes to the API process. WebSocket messages remain hints; reconnect always rebuilds work from authoritative database state.
- Pure constants, normalization, transition guards, card selection, amount calculation, and evidence predicates live in shared modules and are unit-tested without the API or browser.

Recommended file seams:

```text
shared/src/membership-fulfillment.js          # enums, guards, projections
shared/src/membership-evidence.js             # strict predicates and matching
shared/src/spacexcard-openapi.js              # OpenAPI adapter
shared/src/membership-state-provider.js       # gptserve adapter
shared/src/membership-fulfillment-runner.js   # worker orchestration
api/src/membership-fulfillment.js             # admin/extension/webhook routes
background-kw-membership.js                   # versioned incognito browser adapter
```

`api/src/server.js`, `worker/src/worker.js`, `background-wrapper.js`, and the admin files should only register or present these modules. Do not place another large workflow directly in `server.js`.

## 5. Aggregate and state machine

### 5.1 Creation and ownership

When a redeem order uses a product with a configured membership tier, the order transaction creates one Membership Fulfillment in `WAITING_SESSION_ACTIVATION` and snapshots the target tier. This does not change the existing order or activation-job status.

The fulfillment may advance only after the current Session Activation Delivery is `succeeded`. It then derives an account lock from a verified stable ChatGPT account identifier when available, otherwise from normalized verified email. Store a keyed, non-reversible lock value; do not put email in lock/queue logs.

Only one nonterminal fulfillment may hold an Account Fulfillment Lock. A duplicate order enters `ACCOUNT_FULFILLMENT_WAIT`, performs no card selection or money action, and rechecks membership eligibility after the earlier fulfillment terminates.

### 5.2 Happy path

The durable aggregate follows these states:

```text
WAITING_SESSION_ACTIVATION
-> QUEUED
-> ACCOUNT_CHECKING
-> INVENTORY_CHECKING
-> BROWSER_LEASE_WAIT
-> CARD_RESERVED
-> INITIAL_CHECKOUT_PREFLIGHT
-> FUNDING_READY
-> FUNDING
-> PLUS_APPROVAL_WAIT          # canary only
-> PLUS_CHECKOUT_READY
-> PLUS_SUBMIT_PERMITTED       # conservative payment boundary
-> PLUS_RECONCILING
-> PLUS_CONFIRMED
-> UPGRADE_CHECKOUT_PREFLIGHT  # x5/x20 only
-> UPGRADE_APPROVAL_WAIT       # x5/x20 canary only
-> UPGRADE_CHECKOUT_READY
-> UPGRADE_SUBMIT_PERMITTED
-> UPGRADE_RECONCILING
-> FINAL_TIER_CONFIRMED
-> RENEWAL_CANCELLING
-> COMPLETED
```

A Plus fulfillment skips all upgrade states. An automatic-scope fulfillment skips approval-wait states but still consumes its scope quota atomically before the first money boundary and obtains a server submit permit for each payment stage.

No-charge validation is a separate `checkout_validation_run`, not a successful Membership Fulfillment. It stops after validating eligibility, integration availability, target Plus/PH/PHP price, initial page structure, and field locations. It never selects or reserves a final card, moves money, retrieves card details, fills a real PAN, or activates a post-card control.

### 5.3 Exception states

| State | Money rule | Allowed automatic exit |
| --- | --- | --- |
| `ACCOUNT_FULFILLMENT_WAIT` | No card or money | Earlier account lock terminates, then recheck account |
| `ACCOUNT_REPURCHASE_NOT_READY` | No card or money | Regenerate and recognize an eligible Plus checkout later |
| `ACCOUNT_ALREADY_SUBSCRIBED` | Terminal, no money | None; customer/admin handling only |
| `INVENTORY_NOT_READY` | No card or money | Inventory initialization completes |
| `CARD_PRICE_UNAVAILABLE` | No funding or checkout | Fresh complete card-segment prices appear |
| `CHECKOUT_ADDRESS_UNAVAILABLE` | No funding | Address adapter succeeds |
| `CHECKOUT_PRICE_UNRECOGNIZED` | No funding/final submit | Approved contract/version or page facts become valid |
| `CHECKOUT_UI_UNSUPPORTED` | No further click | New tested extension adapter version is deployed |
| `PLATFORM_BALANCE_INSUFFICIENT` | No money request; release no-payment reservation | Platform balance later covers full operation |
| `FUNDING_OUTCOME_UNKNOWN` | Block checkout | Replay the same persisted intent/key/body and validate original result |
| `CHECKOUT_PRE_SUBMIT_FAILED` | No new funding, same card only | Evidence proves no submit/transaction; at most three attempts |
| `UNEXPECTED_PREAUTH` | No final submit | Authoritative reconciliation resolves the authorization |
| `PAYMENT_ACTION_REQUIRED` | Never bypass or resubmit | Local extension acknowledgement permits confirmation queries only |
| `ACTION_REQUIRED_CONTEXT_LOST` | Never rebuild or resubmit | Server reconciliation only; sanitize incognito before queue release |
| `PAYMENT_OUTCOME_UNCERTAIN` | Never resubmit automatically | Evidence-gated reconciliation |
| `PAYMENT_DECLINED` | Never switch/recharge/resubmit | First stage terminates after no-payment proof; upgrade becomes partial |
| `UPGRADE_CHECKOUT_UNAVAILABLE` | Keep paid Plus, card, and reservation | Retry only navigation/recognition with compatible adapter |
| `PARTIALLY_FULFILLED` | Keep paid evidence and occupied capacity | External upgrade evidence or Plus expiry |
| `PARTIAL_FULFILLMENT_EXPIRED` | Terminal; no repurchase/payment/release | Append external compensation resolution only |
| `MEMBERSHIP_CONTRACT_UNKNOWN` | Open shared circuit; no new money | Versioned adapter accepts a fixture-backed contract |

Provider authentication/contract failures and sustained shared outages open a dependency circuit. Already money-bearing fulfillments may continue read-only reconciliation and renewal cancellation; they may not use the outage as permission for another payment.

### 5.4 Submit boundary

The server and DOM click cannot be one transaction. Therefore issuance of a one-time submit permit is the conservative payment boundary:

1. The extension identifies the exact allowlisted final control in a recognized adapter state and requests a permit with the fulfillment, stage, attempt, lease epoch, adapter version, price contract, and sanitized page fingerprint.
2. In one database transaction the server revalidates all facts, atomically consumes the stage's canary authorization or automatic-scope quota, records `*_SUBMIT_PERMITTED`, and invalidates every other permit.
3. Only then may the extension revalidate the same page and click once.
4. A crash or lost response after permit issuance is an uncertain outcome even if the extension cannot prove it clicked. No second permit is issued until evidence proves no payment occurred under the agreed reconciliation rule.

For a recognized intermediate progression control, the server snapshots current card authorization identities before granting a one-time progression permit. After the click, the extension reports the new versioned page state and the server checks for any new transaction. A `$0`, `$1`, or other new authorization enters `UNEXPECTED_PREAUTH`; it is never silently allowlisted.

### 5.5 Completion guard

`COMPLETED` is legal only when all conditions hold in the same aggregate revision:

- The final expected membership observation satisfies the strict membership predicate.
- Every required stage has exactly one new matching OpenAI card authorization absent from its pre-stage snapshot.
- Each matched transaction is `PENDING` or `COMPLETE`, not declined/reversed/refunded.
- x5/x20 has both the initial Plus stage and the final upgrade stage linked to the same fulfillment and reserved card.
- A subsequent membership observation proves `auto_renew === false`.
- No unresolved preauthorization, payment uncertainty, action-required context, or contract mismatch remains.

A `PENDING` transaction plus strict membership may provisionally satisfy the card side and consume capacity. Keep a separate settlement flag under reconciliation. A qualifying live canary and rollout qualification require final `COMPLETE`, not provisional settlement. A later decline, reversal, or refund enters post-completion review and never triggers an automatic replacement payment or automatic capacity restoration.

## 6. Card inventory, lane, capacity, and selection

### 6.1 Initialization and reconciliation

An administrator starts one resumable full inventory initialization. Automatic selection remains disabled until all pages have been imported and every card is either classified or placed on reconciliation hold.

For each card:

- Persist upstream IDs, product code, BIN/card segment, last four digits, status, cached balance, timestamps, lane, and reconciliation state.
- Never persist PAN, CVV, expiry, full address, or full upstream response.
- Pull all transaction pages and deduplicate by `(card_id, auth_id)`, updating the same normalized record as `PENDING` becomes `COMPLETE`.
- For historical initialization only, pair each final x5/x20 transaction with the nearest preceding unpaired Plus transaction on the same card within two hours.
- Missing, late, conflicting, mixed-tier, or over-capacity history places only that card in `RECONCILIATION_HOLD`.

After initialization, verify signed Webhooks as a prompt signal, perform targeted authoritative pulls for changed/uncertain cards, and run a full inventory reconciliation every six hours. Discard the Webhook's `card_number` before persistence or logging. Webhooks never replace authoritative pulls.

### 6.2 Capacity

```text
Plus lane: 5 fulfillments
x5 lane:   2 fulfillments
x20 lane:  1 fulfillment
```

The initial Plus payment of an x5/x20 staged upgrade belongs to that final lane and does not consume a Plus slot. A paid or uncertain partial fulfillment retains its target-lane slot. When capacity is exhausted, mark the card internally `CAPACITY_FULL`; leave the upstream card `ACTIVE` and its balance unchanged.

### 6.3 Price and selection

For every candidate, read `GET /cards/{id}/openai-payments`. A required tier is eligible only when `found === true` and `time` is no more than 72 hours old.

Stage budgets are:

```text
Plus: latest plus amount + USD 0.20
x5:   latest plus amount + USD 0.20 + latest x5 amount + USD 0.20
x20:  latest plus amount + USD 0.20 + latest x20 amount + USD 0.20
```

Do not convert these USD signals to PHP. The displayed checkout amount is validated independently against a versioned PHP price contract.

Selection order is deterministic:

1. Same target-lane cards with remaining capacity, lowest real-time funding shortfall first.
2. Unassigned cards with complete fresh prices.
3. A new card from an administrator-allowed, proven product.

A product is proven only when an existing same-product card supplies all required fresh price tiers. New-card opening uses `init_amount = max(product.min_amount, full order budget)`, rejects a product whose maximum is too small, and requires platform balance for `open_fee + init_amount`.

## 7. Funding and risk limits

Each fulfillment performs at most one card funding operation. Immediately before it:

- Refresh selected card balance or platform balance.
- Calculate only the full-order shortfall and provider fee.
- Persist one immutable Funding Intent before the provider call.
- For x5/x20, fund both stages once; never recharge between stages.

The Funding Intent contains operation type, target card/product, exact amount/fee, encrypted exact request body when replay requires it, body fingerprint, deterministic non-secret idempotency key, and normalized result fields. Use keys such as:

```text
kwr:{orderNo}:open:v1
kwr:{orderNo}:recharge:v1
```

Timeout or disconnect produces `FUNDING_OUTCOME_UNKNOWN`. Recovery may only replay the same body with the same key. It must not recalculate, infer success from a balance delta, create another intent, or continue to checkout before the replayed result is validated.

Every automatic scope has a positive daily order limit and USD risk budget. Before the first money boundary, atomically reserve:

```text
one order unit
full snapshotted payment budget
applicable card-opening or recharge fee
```

Count the full payment budget even when an existing balance avoids recharge. x5/x20 counts once for the combined order. A scope's first activation defaults to one order per Asia/Shanghai business day and a suggested one-order risk estimate. Raising a limit requires fresh password verification and a new scope revision.

## 8. Browser protocol

### 8.1 WebSocket

Reuse the existing authenticated extension WebSocket and installation binding. Add only sanitized notification messages:

```json
{
  "type": "membership.available",
  "fulfillmentId": "mf_...",
  "revision": 12,
  "createdAt": "2026-07-16T00:00:00.000Z"
}
```

```json
{
  "type": "membership.resume",
  "resumeRevision": 4
}
```

No message contains order Session, email, checkout URL, card identity, PAN/CVV, address, price amount, provider response, or grant nonce. Duplicate and out-of-order notifications are expected; the extension pulls current state over REST.

### 8.2 Extension REST

All routes reuse Extension Token plus `X-Extension-Installation-Id`, require the current Browser Fulfillment Lease epoch where applicable, use request limits, and set `Cache-Control: no-store`.

```text
GET  /api/extension/membership-fulfillments/{id}/command
POST /api/extension/membership-fulfillments/{id}/events
POST /api/extension/membership-fulfillments/{id}/progression-permit
POST /api/extension/membership-fulfillments/{id}/submit-permit
POST /api/extension/membership-fulfillments/{id}/action-ack
POST /api/extension/membership-fulfillments/{id}/diagnostic
POST /api/extension/membership-material-grants/{grantId}/claim
```

The command endpoint returns a stable command enum such as:

```text
WAIT
PREFLIGHT_INITIAL_CHECKOUT
CLAIM_STAGE_MATERIAL
PREFLIGHT_UPGRADE
AWAIT_APPROVAL
RECONCILE_ONLY
SANITIZE_AND_RELEASE
```

Non-sensitive command facts include stage, target tier, adapter version, PHP contract version/range, lease epoch, attempt, and expected origin/route. A checkout URL is returned only when needed over this authenticated no-store REST channel.

### 8.3 Single-use material grant

The server persists only grant metadata and a hash of an unpredictable nonce. A grant is bound to fulfillment, stage, attempt, installation ID, browser lease epoch, adapter version, and a short expiry.

On the first valid claim, the API fetches full card details from SpaceX Card and a fresh address into memory, validates both, marks the grant claimed, and returns one no-store response:

```json
{
  "checkoutUrl": "<one-time URL>",
  "card": {
    "number": "<PAN>",
    "cvv": "<CVV>",
    "expiryMonth": "MM",
    "expiryYear": "YYYY"
  },
  "billing": {
    "name": "<fresh name>",
    "line1": "<street>",
    "city": "<city>",
    "state": "DE",
    "postalCode": "<zip>",
    "country": "US"
  },
  "validation": {
    "stage": "plus",
    "targetTier": "x5",
    "currency": "PHP",
    "priceContractVersion": 3,
    "adapterVersion": "checkout-v1"
  }
}
```

The API and reverse proxy must redact this route entirely from access/body logging. The extension keeps the response only in the active JavaScript execution memory, never in `chrome.storage`, IndexedDB, messages to the side panel, errors, or another network request. Loss requires a new grant only after proving no payment or unexpected authorization occurred.

### 8.4 Versioned page adapter

`background-kw-membership.js` owns reviewed code for each known page state. It must:

- Operate only in the current incognito tab and verify the tab belongs to the leased incognito Cookie Store.
- Validate allowlisted origin, route shape, target tier, PH/PHP, displayed amount range, required fields, and structural state.
- Treat progression and final-payment controls as different allowlisted controls.
- Revalidate after every navigation and immediately before a permitted click.
- Cap transitions and detect repeated states.
- Stop on an unknown state without guessing from text.
- Never receive selectors or JavaScript from the server.

Unsupported states may upload only adapter/state IDs, normalized route template, tier/currency/amount, expected-element booleans, and a non-reversible structural hash. Raw DOM, page text, screenshots, form values, email, address, card data, Session, Cookie, tokens, and arbitrary exception strings are rejected server-side.

### 8.5 Human challenges

3DS, CAPTCHA, SMS, and bank verification enter `PAYMENT_ACTION_REQUIRED`, retain the visible incognito page, and pause the global browser queue. The only resume control is local to the extension: “已完成验证，继续核对”. Its acknowledgement authorizes membership and transaction queries only, never another click or payment.

If the tab/window/browser disappears, enter `ACTION_REQUIRED_CONTEXT_LOST`, do not rebuild checkout, and continue server-side evidence reconciliation. The extension clears the affected authentication Cookie allowlist before another order may acquire the browser lease.

## 9. Payment and membership reconciliation

Immediately before each stage's first post-card action, persist the card's current `auth_id` set. After final-submit permit issuance, poll for at most five minutes and require exactly one new matching transaction:

- Merchant normalizes to OpenAI from an authoritative transaction pull.
- `auth_id` was absent from the stage snapshot.
- Amount is inside the tier's documented OpenAI USD range.
- Status is `PENDING` or `COMPLETE`.

Zero or multiple matches is `PAYMENT_OUTCOME_UNCERTAIN`. Never use “latest transaction” alone.

A matching `DECLINED` is a known non-payment only when the membership provider still shows the verified pre-stage state and no other effective transaction exists. It never authorizes switching cards, recharging, or resubmitting.

For a submitted payment with no transaction at all, perform full card-history and membership checks at approximately five minutes, one hour, and 24 hours. Only when all three show the pre-stage membership and no new/pending transaction may the admin console enable “确认未扣款并释放预留”. It is never automatic.

An x5/x20 upgrade decline keeps its Plus evidence and reservation in `PARTIALLY_FULFILLED`. Initially leave Plus renewal enabled for external completion. When the confirmed Plus `expire_time` is at most 72 hours away, automatically request cancellation and keep querying until `auto_renew === false`; the fulfillment remains partial. If Plus expires without x5/x20, enter terminal `PARTIAL_FULFILLMENT_EXPIRED` and never repurchase automatically.

## 10. Persistence model

All timestamps are UTC ISO strings. Business-day quota keys use `Asia/Shanghai`. Every mutable summary table has `updated_at`; evidence and audit records are append-only.

### 10.1 Existing tables

- Add `products.membership_tier TEXT` with application validation `NULL | plus | x5 | x20`.
- Do not add payment state to `redeem_orders.extension_delivery_*`.
- Do not duplicate `redeem_orders.session_payload`; decrypt it only inside fixed server adapters.
- Add the customer-safe Membership Fulfillment projection to `GET /api/public/orders/{orderNo}` without exposing technical/payment details.

### 10.2 Core fulfillment tables

`membership_fulfillments`

```text
id PK
order_id UNIQUE
order_no UNIQUE
target_tier
state
current_stage
run_mode                       # canary | automatic
account_lock_key
resume_revision
state_revision
retry_at
money_boundary_at
browser_lease_epoch
card_reservation_id
failure_code
created_at / updated_at / completed_at
```

`membership_fulfillment_attempts` (append-only)

```text
id PK
fulfillment_id FK
stage                          # eligibility | plus | upgrade | renewal
attempt_no
resume_revision
adapter_version
price_contract_version
started_at / ended_at
outcome_code
sanitized_diagnostic
UNIQUE(fulfillment_id, stage, attempt_no)
```

`membership_payment_stages`

```text
id PK
fulfillment_id FK
stage_key                      # plus | upgrade
expected_tier
state
card_id
price_signal_amount/min/max/time
auth_snapshot_at
submit_permitted_at
submit_reported_at
matched_auth_id
settlement_state
membership_observation_id
confirmed_at
UNIQUE(fulfillment_id, stage_key)
```

`membership_observations` (append-only, normalized only)

```text
id PK
fulfillment_id FK
stage_key / purpose
provider_code
account_type
currency
auto_renew
is_overdue / is_delinquent
expire_time
observed_at
```

### 10.3 Card tables

`managed_cards`

```text
id PK                         # local stable ID
upstream_card_id UNIQUE
vm_card_id UNIQUE
product_code
bin
last4
upstream_status
cached_available_amount
lane                          # NULL | plus | x5 | x20
capacity_state
reconciliation_state
last_balance_sync_at
last_transaction_sync_at
created_at / updated_at
```

`managed_card_transactions`

```text
card_id FK
auth_id
auth_time
auth_amount / auth_currency
settle_amount / settle_currency
type / status
merchant_normalized
decline_reason_code
first_seen_at / last_seen_at
PRIMARY KEY(card_id, auth_id)
```

`card_price_signals`

```text
card_id FK
tier
found
amount / min_usd / max_usd
provider_time
fetched_at
PRIMARY KEY(card_id, tier)
```

`card_capacity_reservations`

```text
id PK
fulfillment_id UNIQUE
card_id FK NULL                  # attached after a successful new-card open
planned_product_code NULL        # durable new-card plan before opening
target_lane
slot_index
state                         # reserved | consumed | retained_partial | released
reserved_at / consumed_at / released_at
release_evidence_revision
```

Use a partial unique index over active/consumed `(card_id, target_lane, slot_index)` when `card_id` is present. An existing-card reservation claims its slot before preflight. A new-card plan durably reserves the fulfillment/product/lane before funding; after the idempotent open succeeds, attach the returned card and its first slot in the same local transaction before checkout may proceed. A release is a state transition with evidence; rows are never deleted.

`card_inventory_runs` and `card_inventory_run_items` store resumable page/card progress and normalized errors. `card_product_policies` stores administrator-allowed product codes and revisions. Neither stores credentials or card details.

### 10.4 Money and browser tables

`funding_intents`

```text
id PK
fulfillment_id UNIQUE
operation                     # open | recharge
target_card_id / product_code
amount / fee
idempotency_key UNIQUE
request_fingerprint
request_body_encrypted
state                         # prepared | submitted | succeeded | outcome_unknown | failed
provider_resource_id
created_at / submitted_at / resolved_at
```

`browser_fulfillment_lease` is a singleton row containing fulfillment, installation, epoch, state, heartbeat, and expiry. Lease acquisition/release increments the epoch; every browser command and grant binds that epoch.

`membership_material_grants` stores grant ID, nonce hash, fulfillment/stage/attempt/lease bindings, expiry, and claimed time only. It never stores the returned material.

### 10.5 Pricing, rollout, and operations tables

`checkout_price_contracts` is append-only/versioned by tier with PHP min/max, status, creator, and activation time. One active version per tier is enforced.

`checkout_validation_runs` records no-charge results for site/product/tier/adapter/price-contract versions and sanitized field/state facts.

`live_canary_authorizations` stores the immutable order, stage, tier, selected card, exact funding budget, price-contract version, adapter version, approving admin/time, state, and consumption time. It does not store the re-entered password.

`tier_rollout_qualifications` records the one strict, settled canary that qualifies an exact tier/adapter/path/price-contract version.

`automatic_checkout_scopes` is append-only by revision and binds site, product, tier, adapter version, price-contract version, activation time, daily order limit, daily USD risk limit, admin, and enabled/paused status. A new adapter or price-contract version pauses matching scopes.

`automatic_checkout_daily_usage` has a unique `(scope_id, business_date)` and atomically tracks order units and USD risk reserved.

`fulfillment_dependency_circuits` stores normalized dependency/scope, state, failure count, opened time, retry time, and recovery revision.

`fulfillment_interventions` stores one deduplicated task per `(fulfillment_id, state, state_revision)`, acknowledgement metadata, and Feishu delivery metadata. Acknowledgement never changes workflow state.

`customer_compensation_resolutions` is append-only and accepts only `REFUNDED`, `REPLACEMENT_DELIVERED`, or `CUSTOMER_ACCEPTED_PARTIAL`, plus admin, server time, and external evidence reference. It invokes no money/card action.

`membership_outbox` contains sanitized notification type, aggregate ID, revision, timestamps, and dispatch state. It never contains sensitive material.

## 11. Admin API and console

All routes use `requireAdmin`. Canary approval, scope creation/re-enable, and limit increases additionally verify the current username and re-entered `env.adminPassword` for that request, with rate limiting and constant-time comparison. Passwords are never logged, persisted, echoed, or included in audit details.

Suggested API surface:

```text
GET/PATCH /api/admin/membership-fulfillment/settings
POST      /api/admin/membership-inventory/initialize
GET       /api/admin/membership-inventory/runs/current
POST      /api/admin/membership-inventory/refresh
GET       /api/admin/membership-cards
GET       /api/admin/membership-cards/{id}
POST      /api/admin/membership-cards/{id}/reconcile

GET/POST  /api/admin/checkout-price-contracts
POST      /api/admin/checkout-price-contracts/{id}/activate
GET/PUT   /api/admin/card-product-policies

GET       /api/admin/membership-fulfillments
GET       /api/admin/membership-fulfillments/{id}
POST      /api/admin/membership-fulfillments/{id}/recheck
POST      /api/admin/membership-fulfillments/{id}/resume
POST      /api/admin/membership-fulfillments/{id}/compensations

GET/POST  /api/admin/checkout-validation-runs

POST      /api/admin/live-canary-authorizations
GET       /api/admin/tier-rollout-qualifications
GET/POST  /api/admin/automatic-checkout-scopes
POST      /api/admin/automatic-checkout-scopes/{id}/disable
POST      /api/admin/automatic-checkout-scopes/{id}/increase-limits

GET       /api/admin/fulfillment-circuits
POST      /api/admin/fulfillment-circuits/{id}/probe
GET       /api/admin/fulfillment-interventions
POST      /api/admin/fulfillment-interventions/{id}/ack
```

The console may initialize/refresh inventory, show masked cards and lane/capacity/hold state, manage price contracts and allowed products, approve canary stages, enable/disable exact rollout scopes, request authoritative rechecks, acknowledge alerts, and append compensation results.

It must not contain buttons for direct card opening, recharge, card refund, freeze, delete, forced payment retry, forced success, forced failure, or evidence-free reservation release.

## 12. Customer projection

Extend the public order response with a safe projection:

```json
{
  "membershipDelivery": {
    "status": "processing",
    "label": "处理中",
    "targetTier": "x5",
    "updatedAt": "2026-07-16T00:00:00.000Z"
  }
}
```

Mapping:

| Internal truth | Customer label |
| --- | --- |
| Before strict final completion | 处理中 |
| `PARTIALLY_FULFILLED` | 人工处理中 |
| `PARTIAL_FULFILLMENT_EXPIRED` without compensation | 售后处理中 |
| `ACCOUNT_ALREADY_SUBSCRIBED`, first-stage decline, or another terminal non-success | 人工处理中 |
| `COMPLETED` | 交付成功 |
| Compensation `REFUNDED` | 已退款 |
| Compensation `REPLACEMENT_DELIVERED` | 已补发 |
| Compensation `CUSTOMER_ACCEPTED_PARTIAL` | 已协商完成 |

Do not expose card, provider, payment, Session, email, error-code, renewal, or reconciliation details. Existing order/job status remains available for backward compatibility, but the UI must not use it to claim membership success.

## 13. Retry, circuit, and scheduling rules

- Browser pre-submit failures: same card and existing balance, maximum three attempts, only after proving no submit/membership change/new transaction.
- Funding unknown: replay only the immutable intent with the same key/body.
- Payment submitted or submit permit issued: never automatically submit again.
- No-transaction reconciliation: approximately 5 minutes, 1 hour, and 24 hours.
- Inventory: targeted pulls on signals and full reconciliation every six hours.
- Partial renewal guard: query at least hourly; at `expire_time - 72h`, enter cancellation recovery until `auto_renew=false`.
- Ordinary 24-hour expiry applies only before any open/recharge/payment request. Money-bearing or unknown outcomes do not auto-expire.
- Shared auth or contract drift opens its circuit immediately. Three consecutive throttling/timeout/server failures inside five minutes open a 15-minute circuit; a single half-open probe controls recovery, with repeated failures backing off up to one hour.
- Page adapter mismatch opens only the exact tier/path/version circuit. Account ineligibility and explicit decline remain order-local.

Critical states create a red console task and a deduplicated Feishu notification: human payment action, funding/payment uncertainty, partial/expired partial fulfillment, renewal cancellation failure, and opened circuit. Messages contain only safe order identifier, tier, normalized reason, time, and requested action.

## 14. Rollout

### 14.1 Modes

1. `disabled`: no Membership Fulfillment money/browser checkout work.
2. `no_charge`: validates only states reachable without card material or post-card actions.
3. `canary`: one administrator-approved order/stage at a time; every stage approval requires fresh password verification.
4. `automatic`: only exact enabled scopes and only within their daily limits.

A prepared canary stage may hold the browser lease for at most 15 minutes awaiting approval. Expiry invalidates the page/approval snapshot, discards ephemeral material, sanitizes incognito state, and releases the browser lease, while retaining the fulfillment, card reservation, funding intent, balance, and confirmed earlier stages.

### 14.2 Qualification order

Rollout order is fixed:

```text
Plus -> x5 -> x20
```

One strict live canary with transaction settlement `COMPLETE`, correct final membership, `auto_renew=false`, and no unresolved outcome qualifies that exact tier/adapter/path/PHP-contract version and allows the next tier to begin its own validation. It does not automatically enable an automatic scope.

Creating a scope requires fresh password verification and explicit confirmation of site, product, tier, adapter version, PHP contract version, daily order limit, and daily USD risk limit. Scopes affect only matching orders created after activation. Older queued orders remain canary-only. Disabling a scope stops work before the money boundary; money-bearing work continues only toward safe reconciliation and renewal protection.

## 15. Implementation sequence

### Phase 0 — remove unsafe click behavior

- Remove text-scored/random automatic checkout clicks from `background-autofill.js`.
- Ensure the new automation cannot call the legacy extension SpaceX account or checkout path.
- Add an extension test proving that filling fields never clicks progression or final payment.
- Keep every server payment gate disabled.

### Phase 1 — contracts and persistence, read-only

- Add strict provider adapters and redacted fixtures.
- Add product tier, settings, inventory, card, transaction, price, fulfillment, evidence, outbox, and circuit schema.
- Add pure transition/evidence/selection tests.
- Add admin credentials UI, but no OpenAPI write calls.

### Phase 2 — inventory and no-charge console

- Implement resumable inventory initialization, Webhook verification, authoritative reconciliation, price refresh, card lane/capacity classification, and masked admin views.
- Implement PHP price contracts, allowed products, no-charge validation, and dependency circuits.
- Verify no card details or money writes are reachable.

### Phase 3 — fulfillment orchestration without final submit

- Create the aggregate with new orders, account locks, browser lease, eligibility checks, checkout broker, extension commands, diagnostics, material-grant metadata, and customer-safe status.
- Exercise recognized checkout pages without retrieving/filling real card data or clicking post-card controls.

### Phase 4 — funding behind canary gate

- Implement atomic card reservations, risk quota, immutable Funding Intent, idempotent open/recharge, and unknown-outcome recovery.
- Keep submit permits disabled until funding and reconciliation integration tests pass.

### Phase 5 — Plus live canary

- Release the versioned Plus page adapter, material claim, progression permit, final submit permit, dual confirmation, and renewal cancellation.
- Run one explicit Plus canary; require `COMPLETE`, correct Plus, and `auto_renew=false`.

### Phase 6 — x5 then x20

- Add versioned plan-management and upgrade states.
- Run independently approved x5 Plus and upgrade stages, qualify x5, then repeat for x20.
- Exercise multi-step checkout variants and human-challenge recovery separately.

### Phase 7 — limited automatic scopes

- Enable one exact scope at the default one-order/day limit.
- Monitor circuits, settlements, capacity, renewals, and customer projection.
- Raise limits only through a new freshly authenticated scope revision.

## 16. Minimum runnable checks

### Server/shared tests

- Membership type whitelist and strict completion predicate, including unknown/null contract failure.
- Exactly-one transaction delta matching; pending, complete, decline, reversal, refund, zero, and multiple-match cases.
- Historical two-hour upgrade pairing and reconciliation holds.
- Lane capacity and atomic reservation under concurrent SQLite transactions.
- Deterministic selection and fresh-price rejection after 72 hours.
- Fixed USD 0.20 per stage and full x5/x20 budget.
- Funding Intent commit-before-call, same-key replay, and unknown outcome.
- Account lock and duplicate-order wait/recheck.
- Daily quota counts pre-funded cards and provider fees once.
- Raw-body Webhook HMAC, duplicate/out-of-order events, and proof that `card_number` is discarded.
- No-transaction 5m/1h/24h release guard.
- Partial renewal cancellation at 72 hours and expired-partial terminal behavior.
- Fresh password required for canary/scope/risk increases; password absent from DB/audit/log captures.
- Public projection never marks Session activation or intermediate Plus as target-tier success.

### Extension tests

- Incognito-only tab/store and exclusive membership queue.
- No text-scored click and no timer-based final action.
- Known single-page and multi-step adapter fixtures; unknown state stops without click.
- Card/address material remains absent from `chrome.storage.local`, `chrome.storage.session`, IndexedDB, runtime messages, and errors.
- One-time material claim and lease/attempt mismatch rejection.
- Progression and submit permits are single-use; crash after permit becomes uncertain and does not reclick.
- `$0/$1` or any new intermediate authorization blocks final submit.
- Challenge acknowledgement performs confirmation only.
- Sanitized diagnostic rejects raw HTML/text/screenshot/form data.
- Ordinary-window Cookies and tabs remain untouched.

### Controlled production acceptance

- Inventory initialization completes with every card classified or held.
- No-charge Plus validation succeeds without selecting a card or moving money.
- One explicitly approved Plus canary settles `COMPLETE`, membership is Plus/PHP/healthy, and `auto_renew=false`.
- x5 and x20 each repeat their own full two-stage canary with separate stage approvals.
- No unresolved payment, preauthorization, refund, renewal, adapter, or circuit outcome remains for a qualifying canary.
- `sub2api/` remains unchanged.

## 17. Current implementation status

Phase 4–7 代码实现与模拟验证完成；受控生产验收待执行。

Implemented and covered by local fixture/simulation checks:

- Session Activation Delivery retains incognito Cookie identity verification and starting subscription protection as an independent workflow.
- The extension autofill wrapper no longer text-scores or automatically clicks progression/final-payment controls and no longer uses the external address fallback.
- Strict gptserve and SpaceX Card OpenAPI adapters, membership/card/evidence/rollout schema, masked inventory, historical lane/capacity reconciliation, three-tier price signals, and deterministic USD `+0.20` stage budgeting exist.
- Inventory initialization is resumable. Shared OpenAPI failures retry without placing every card on HOLD; a completed refresh marks truly missing cards internally without deleting or freezing them. Signed Webhooks discard PAN, deduplicate/out-of-order fold, queue a targeted authoritative pull, and full refresh is scheduled every six hours.
- The admin console manages encrypted credentials, masked inventory, PHP price-contract versions, proven product allowlisting, strict sanitized no-charge observation records, and dependency circuits. It contains no card opening, recharge, refund, freeze, delete, forced payment, or forced-result actions.
- Eligible new redeem orders now create exactly one Membership Fulfillment with a snapshotted product tier. Successful Session Activation Delivery activates a keyed, non-reversible account lock; duplicate ChatGPT identities wait behind the current holder instead of overlapping card or browser work.
- The Worker performs the starting-membership query from the protected Session, stores only normalized observations, stops a healthy paid account, holds a delinquent or unknown account without spending, and advances a free account only after read-only inventory, fresh-price, PHP contract, and checkout-broker readiness checks pass.
- The fixed Plus/PH/PHP checkout broker, exclusive epoch-bound browser lease, heartbeat/expiry protocol, sanitized outbox notifications, and versioned `checkout-v1` extension preflight are implemented. During no-charge preflight the extension uses only the incognito Cookie Store, recognizes allowlisted page structure, submits a strictly allowlisted diagnostic, activates no control, and sanitizes the context before releasing the lease.
- Public orders expose only the safe Membership Delivery projection. The admin console exposes a read-only fulfillment list and attempt detail without account identity, Session, checkout URL, or card material.
- Phase 4 implements atomic card-capacity reservation, deterministic selection/opening plans, immutable Funding Intent persistence before provider calls, exact body/idempotency-key replay for unknown outcomes, single-funding execution, and per-order Automatic daily order/risk ledger consumption.
- Phase 5 implements stage-bound single-use material claim, in-memory card/address autofill, progression and submit permits, single-page and multi-step checkout state transitions, Plus dual-provider reconciliation, human-challenge confirmation-only recovery, and final renewal cancellation verification.
- Phase 6 implements versioned x5/x20 plan-management and upgrade checkout flows. Their initial Plus payment stays in the final target lane, the plan-management action does not consume a checkout canary, and the actual upgrade checkout has its own stage authorization and confirmation.
- Phase 7 implements ordered Plus → x5 → x20 qualification, 15-minute single-order canary authorization, exact versioned Automatic scopes, a default one-order/day ledger, scope revisioning, version-drift pause, intervention acknowledgement, and append-only customer compensation records.
- The payment REST surface binds material claims, progression/submit permits, activation reports, canary approvals, qualifications, scopes, interventions, and compensation to the durable fulfillment. The extension recomputes the sanitized page SHA-256 fingerprint and never receives remote selectors or executable rules.
- The Worker connects the gated funding runner, authoritative transaction/membership reconciliation, and renewal cancellation/recheck loop. A `COMPLETED` fulfillment requires the correct final target tier, exactly one matching new stage transaction, and a subsequent `auto_renew=false` observation.
- The operations console exposes rollout and evidence-gated recovery controls, but no direct card opening, recharge, refund, deletion, freezing, force-success, or force-retry action.

Production acceptance remains deliberately pending:

- The payment gate defaults off. Local implementation and fixture checks do not authorize a real SpaceX Card opening, recharge, ChatGPT checkout submission, or production rollout scope.
- Run the controlled production sequence in order: inventory initialization and no-charge validation, one explicitly approved Plus canary through settled `COMPLETE` plus `auto_renew=false`, then separately approved x5 and x20 staged canaries, and only then an exact one-order/day Automatic scope.
- A provisional `PENDING` authorization may keep fulfillment convergence moving, but it cannot earn rollout qualification until it settles `COMPLETE`; unresolved payment, preauthorization, refund, renewal, adapter, or circuit outcomes block qualification.
- `sub2api/` remains an unchanged upstream/reference checkout and is outside this implementation.
