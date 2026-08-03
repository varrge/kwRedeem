# KaWang Domain

KaWang manages redeemable cards, external site integrations, and operational data that must survive deployment and server moves.

Implementation status: Phase 4–7 代码实现与模拟验证完成；受控生产验收待执行。 The production payment gate remains default-off, and no live card opening, recharge, checkout payment, or rollout qualification is implied by this status.

## Language

**Full Server Migration**:
Moving one KaWang deployment from an old server to a new server so the same service continues with its business data and operational settings intact.
_Avoid_: Version upgrade, code-only deployment

**Migration Asset**:
A piece of KaWang business data or operational configuration that must be preserved during a full server migration because losing it would change user-visible state or break integrations.
_Avoid_: Cache, dependency, temporary file

**Sensitive Migration Package**:
A full server migration archive that contains KaWang migration assets, including secret-bearing configuration such as `.env`, and must be handled as confidential operational material.
_Avoid_: Public backup, export bundle

**Migration Asset Whitelist**:
The explicit list of files or directories allowed into a sensitive migration package. It includes required business assets and excludes source code, dependencies, caches, logs, temporary files, and reference checkouts.
_Avoid_: Full project archive, directory dump

**Online Restore**:
A full server migration restore initiated from the KaWang admin UI while the service is reachable, with the backend first moving the system into maintenance mode to block user-facing writes.
_Avoid_: Hot restore, direct database overwrite

**Registration Invite Code**:
A Sub2api `type=invitation` redeem code created through the remote official Sub2api admin API. KaWang records which existing player issued it and layers invite-rebate behavior locally.
_Avoid_: Affiliate code, referral code, promo code

**Recoverable Invite Creation**:
KaWang creates a local pending invite request before calling the remote Sub2api admin API. If the remote call or local finalization fails, the request remains in pending/error state so admin sync or manual recovery can reconcile it instead of silently losing a remote-created code.
_Avoid_: Ignoring remote-created codes after local failure, generating duplicate replacement codes blindly

**Registration Invite Usage Sync**:
KaWang discovers who used a registration invite code by syncing remote Sub2api admin redeem-code data such as `used_by`, `used_by_email`, and `used_at`, then updates the local invite record.
_Avoid_: Requiring Sub2api registration-page callbacks, changing upstream registration logic

**Locked Registration Inviter**:
The inviter for a registration invite relationship is the Sub2api user that applied for the `type=invitation` code. Once the code is used, rebates for that invitee stay assigned to that inviter and do not follow later manual or affiliate relationship changes.
_Avoid_: Reassigning earned invite rebates after registration

**Self-Used Registration Invite**:
A registration invite code whose synced remote `used_by` user is the same Sub2api user that applied for the code. KaWang does not block the remote registration flow, but marks the invite as abnormal and does not generate a rebate.
_Avoid_: Paying rebates on self-use, modifying upstream registration just to block self-use

**First Balance Acquisition**:
The invited player's first successful remote Sub2api balance acquisition after registering with a registration invite code, whether it comes from a paid balance recharge order or a balance-code redemption. If the first acquisition is a paid balance recharge, the rebate base is the payment amount; if it is a balance-code redemption, the rebate base is the code value.
_Avoid_: Registration-code use, subscription purchase, bet settlement, later balance acquisition

**First Balance Acquisition Detection**:
KaWang detects the invited player's first balance acquisition by comparing remote occurrence times after registration: paid balance orders use their paid/completed time, and balance-code redemptions use `used_at`. The earliest qualifying event creates one locked rebate candidate.
_Avoid_: Highest amount, daily aggregate, recalculating after later balance acquisitions

**Registration Invite Rebate Rate**:
A KaWang admin setting that controls what percentage of an invited player's first balance redemption is credited back to the inviter.
_Avoid_: Sub2api native affiliate rate, hard-coded rebate percentage

**Invite Rebate Amount Precision**:
Registration invite rebate amounts are calculated with decimal arithmetic and rounded to 2 decimal places using standard half-up rounding.
_Avoid_: Binary floating-point drift, hidden truncation

**Pending Registration Invite Rebate**:
A KaWang-held rebate record created after an invited player's first balance acquisition, waiting for an admin to approve it before KaWang credits the inviter's remote Sub2api balance. The rebate uses the inviter's current level at the time of the first balance acquisition and stores the applied rate as a snapshot.
_Avoid_: Auto-paid rebate, manual note without payout state

**Registration Invite Rebate Review**:
The admin workflow for a registration invite rebate. Admins may approve a pending rebate to credit the inviter's remote Sub2api balance, reject it with a reason, or revoke an already approved rebate by deducting the credited amount back from the inviter's remote Sub2api balance.
_Avoid_: One-way approval only, duplicate approval payout

**Invite Rebate Balance Note**:
Remote Sub2api balance adjustments for invite rebates use a standardized note containing the invite code, invitee user ID, and KaWang rebate ID; revocations use a standardized revoke note containing the rebate ID.
_Avoid_: Ambiguous balance notes that cannot be matched back to KaWang records

**Registration Invite Rebate Audit View**:
The admin review list for registration invite rebates shows inviter, invitee, invite code, first balance acquisition source type, first amount, rebate-rate snapshot, rebate amount, current status, generated time, review/rejection/revocation reason, and remote balance operation result.
_Avoid_: Minimal payout-only list, dumping raw remote JSON as the primary UI

**Masked Invitee Display**:
Frontend invite pages may show invitee identity only in masked form, alongside first balance acquisition amount, rebate amount, and review status.
_Avoid_: Exposing full invitee email or username to another player

**Invite Rebate Summary Display**:
The frontend separates pending, paid, and rejected/revoked rebate amounts. Lifetime/total earnings count only paid rebates, not pending or rejected/revoked records.
_Avoid_: Presenting pending rebates as earned balance

**Inviter Level**:
A KaWang-managed level assigned to an existing Sub2api user that controls how many registration invite codes the user may apply for.
_Avoid_: Global fixed invite quota, Sub2api native user role

**Inviter Level Rule**:
A KaWang admin-configured rule that maps recharge thresholds to invite-code quotas and registration-invite rebate rates. The frontend shows the player's current level benefits and only the recharge amount needed for the next level.
_Avoid_: Hard-coded tiers, frontend-configured rebate rules

**Inviter Level Recalculation**:
When admins save inviter level rules, KaWang refreshes locally known Sub2api users' remote recharge spend and recalculates stored/effective inviter levels from the updated spend and level overrides.
_Avoid_: Leaving displayed levels stale after rule changes, recalculating from old spend after a rule save

**Known Sub2api User**:
A remote Sub2api user that KaWang has encountered and stored locally, such as an invite-code applicant, a synced invitee, or a user manually synced by an admin.
_Avoid_: Pulling every remote Sub2api user by default

**Inviter Level Override**:
An admin-assigned per-user inviter level that takes precedence over the automatically matched level from accumulated recharge spend. Without an override, KaWang uses the highest configured level whose spend threshold is not greater than the user's cached inviter level spend.
_Avoid_: Frontend-selected level, hidden hard-coded special cases

**Inviter Level Progress Display**:
The frontend displays current inviter benefits from the effective level, while the "amount needed for next level" is always calculated from cached recharge spend against the automatic level thresholds, even when an admin level override is active.
_Avoid_: Hiding spend progress because of an override

**Inviter Level Spend**:
The user's accumulated successful balance recharge amount from remote Sub2api admin balance history, used to determine their inviter level. It is not based on subscription purchases, API usage spend, invite rebates, World Cup balance changes, or current remaining balance.
_Avoid_: Subscription spend, API usage spend, current balance, all balance increases, local-only estimate when remote balance history is available

**Inviter Level Spend Sync**:
KaWang caches each user's remote recharge spend locally. The invite page may trigger a refresh, and admins can manually refresh it; frontend display uses the cached result instead of blocking on a full remote balance history scan every time.
_Avoid_: Every page render depends on a full remote balance history scan

**Invite Page Sync Refresh**:
The invite page automatically requests a sync on entry and also lets the player manually refresh invite usage, level spend, and rebate status, with a 60-second cooldown to protect the remote Sub2api admin APIs.
_Avoid_: Unbounded player-triggered remote admin syncs

**Invite Code Quota Limits**:
Each inviter level may define both a lifetime invite-code application limit and a current unused-code limit. A configured value of `0` means unlimited for that specific limit.
Expired invite codes do not count against either limit. A configured value of `0` means unlimited for that specific limit.
_Avoid_: One global fixed quota, treating zero as no invites allowed, expired codes consuming quota

**Store Fulfillment Order**:
A paid Dujiao store order awaiting or undergoing delivery, from which KaWang may issue the purchased manual-processing CDK.
_Avoid_: KaWang redeem order, activation job

**Manual-Processing CDK**:
A KaWang redeemable card whose eventual redemption creates work for an operator instead of starting automatic activation.
_Avoid_: Source key, automatically activated CDK, fulfillment record

**Voided CDK Queue Cancellation**:
When an administrator voids a redeemed CDK, KaWang atomically cancels its still-pending activation job, Session Activation Delivery, redeem order, and pre-exposure Membership Fulfillment. A task already processing an external activation, holding a browser lease or card reservation, or entering the funding/payment boundary blocks the void action instead of pretending that in-flight work was cancelled. Completed delivery truth remains unchanged.
_Avoid_: Voiding only the CDK row, reviving a cancelled queue item, discarding payment or reservation evidence

**Store Product Mapping**:
An explicit association from a Dujiao product and optional SKU to the kind, KaWang site, and public prefix of the manual-processing CDK the purchase promises.
_Avoid_: Product-title matching, implicit prefix matching

**Store Connection**:
The single Dujiao store that KaWang observes and fulfills using a dedicated service administrator.
_Avoid_: KaWang site, Sub2api connection, buyer account

**Order-Issued CDK**:
A new manual-processing CDK created specifically for one purchased unit in a store fulfillment order rather than selected from pre-existing card inventory.
_Avoid_: Stock CDK, shared CDK, reusable CDK

**Store-Delivered CDK**:
An order-issued CDK whose value has been confirmed in the Dujiao fulfillment but remains redeemable in KaWang until the buyer submits it for manual processing.
_Avoid_: Used CDK, completed manual-processing order

**Store Order Number**:
The customer-facing Dujiao parent order number that identifies the purchase for which an order-issued CDK was created.
_Avoid_: Store fulfillment target number, KaWang redeem order number

**Store Fulfillment Target Number**:
The Dujiao child order number that identifies the exact order unit receiving an order-issued CDK; it is absent when the parent order itself is the delivery target.
_Avoid_: Customer-facing parent order number, KaWang activation job number

**CDK Origin**:
The business source from which a CDK entered KaWang, such as a store-order issuance, an administrator creation, or a batch import.
_Avoid_: Processing type, manual-processing kind

**Store Fulfillment Task**:
KaWang's durable record of one Dujiao order delivery attempt and the exact order-issued CDKs assigned to it across retries.
_Avoid_: Activation job, disposable polling attempt

**Confirmed Store Fulfillment**:
A Dujiao fulfillment whose buyer-visible payload matches the complete CDK assignment in the corresponding KaWang store fulfillment task. Historical fulfillments may instead match the legacy structured delivery identity.
_Avoid_: Assuming success from an HTTP timeout, treating any existing fulfillment as success

**Store Fulfillment Conflict**:
A Dujiao order that already contains fulfillment data different from the CDKs assigned by its KaWang store fulfillment task.
_Avoid_: Automatic overwrite, blind success

**Retryable Store Fulfillment Failure**:
A temporary transport, throttling, or remote-service failure for which KaWang can safely retry the same store fulfillment task and assigned CDKs.
_Avoid_: Issuing replacement CDKs, treating configuration errors as transient

**Blocked Store Fulfillment**:
A store fulfillment task that requires an operator decision because its product is unmapped, its order changed incompatibly, or its remote fulfillment conflicts with KaWang's assignment.
_Avoid_: Endless automatic retry, silent skip

**Managed Payment Card**:
A SpaceX Card payment card whose upstream identity and operational metadata are tracked by KaWang for ChatGPT membership fulfillment. Full payment credentials are not part of KaWang's card inventory.
_Avoid_: Stored card credentials, disposable checkout payload

**Session Activation Delivery**:
The existing extension process that installs an order's ChatGPT authentication cookies into the incognito store, verifies identity, and completes the starting subscription-protection check. Its success does not mean that a membership was purchased.
_Avoid_: Membership fulfillment, payment completion

**Membership Fulfillment**:
The independent, durable order process that establishes purchase eligibility, reserves and funds a card, completes the required payment stages, confirms the target membership, and disables renewal. It alone owns card, payment, upgrade, and renewal-safe completion state.
_Avoid_: Overloading session activation status, using the redeem order's generic status as payment state

**Fulfillment Attempt**:
An append-only execution record for one pass through a membership-fulfillment stage. Retrying or operator-resuming creates another attempt without replacing the fulfillment, its prior evidence, reservation, or funding intent.
_Avoid_: New fulfillment per retry, resetting history, reusing session-delivery attempt counters

**Browser Fulfillment Lease**:
The exclusive right for one membership fulfillment to use the bound extension's shared incognito context and enter card reservation or money-moving stages. Read-only inventory and price reconciliation do not require this lease.
_Avoid_: Pre-funding queued orders, treating separate incognito windows as isolation, per-card browser concurrency

**Account Fulfillment Lock**:
The exclusive claim allowing only one active membership fulfillment for a verified ChatGPT identity. A later order waits without card or money exposure and must re-establish purchase eligibility after the earlier fulfillment terminates.
_Avoid_: Concurrent purchases for one account, permanent rejection of a harmless duplicate, assuming the earlier outcome left the account eligible

**Card Membership Lane**:
The single final ChatGPT membership tier assigned to a managed payment card from recognized fulfillment history. A card may serve Plus, x5, or x20, but never more than one final tier; the initial Plus charge of a staged x5/x20 upgrade belongs to that final tier.
_Avoid_: Mixed-tier card, per-order card type

**Card Reconciliation Hold**:
A managed payment card excluded from automatic checkout because its historical OpenAI payments contain incompatible final tiers, exceed capacity, or cannot be grouped into recognized fulfillment patterns confidently.
_Avoid_: Guessing a lane, treating uncertain history as unused capacity

**Target Membership Tier**:
The final ChatGPT membership outcome purchased by a redeem order: Plus, x5, or x20. It is defined explicitly by the purchased KaWang product and remains fixed for the lifetime of the order.
For manual-processing membership CDKs, the stored `manual_type` is the immutable purchased-tier snapshot used at redemption; product `membership_tier` remains the source for non-manual product orders.
_Avoid_: Inferring the tier from a site slug, product title, or CDK prefix; ignoring the explicit manual-CDK type

**Staged Membership Upgrade**:
The fulfillment path for an x5 or x20 order that first purchases Plus and then returns to ChatGPT plan management to change to the target tier. Its Plus charge and upgrade charge are two effective payments for one membership fulfillment.
_Avoid_: Treating the initial Plus charge as a separate Plus order, direct x5/x20 checkout

**Card Capacity Slot**:
One completed membership fulfillment in a managed payment card's membership lane, independent of how many payment stages that fulfillment requires. A Plus card has five slots, an x5 card has two, and an x20 card has one.
_Avoid_: Counting raw payment transactions as capacity, sharing one slot across orders

**Capacity-Full Card**:
A managed payment card whose membership lane has consumed all five Plus, two x5, or one x20 capacity slots. It remains active upstream with its balance untouched, but is no longer eligible for automatic membership selection.
_Avoid_: Deleting or freezing a full card, automatically refunding its remainder, selecting it for another membership

**Card Capacity Reservation**:
An internal scheduling claim linking one redeem order to one capacity slot before funding or checkout begins. Releasing it only ends that order's claim; it never deletes, freezes, or otherwise changes the upstream card, and it is allowed only when KaWang can prove that no payment occurred.
_Avoid_: Selecting a card without a durable claim, treating release as a card operation, releasing after payment or an uncertain outcome

**Single-Funding Fulfillment**:
A membership fulfillment whose card is brought to the required available balance once before its first checkout stage, using only the shortfall after a real-time balance check. No recharge occurs when the card is already sufficiently funded, and staged x5/x20 upgrades are not recharged between stages.
_Avoid_: Per-stage card recharge, relying on an unplanned existing balance for the initial Plus charge

**Funding Intent**:
The durable, immutable instruction for an order's single card-opening or recharge operation, including its target, amount, request fingerprint, and provider idempotency key. Every recovery attempt replays that exact instruction rather than creating another funding operation.
_Avoid_: Recalculating a timed-out write, generating a new retry key, inferring success only from a balance delta

**Unknown Funding Outcome**:
The state after a funding request loses its authoritative response. Checkout remains blocked while KaWang recovers the original result by replaying the same funding intent with the same idempotency key.
_Avoid_: Funding again, changing the request body, proceeding because the card appears funded

**Stage Funding Budget**:
The card balance reserved for one OpenAI payment stage, equal to the selected card segment's latest matching OpenAI payment plus the fixed stage safety allowance. A staged upgrade's order budget is the sum of its Plus and final-tier stage budgets.
_Avoid_: Using a global price from another card segment, adding an administrator floor

**Stage Safety Allowance**:
The fixed USD 0.20 added independently to every effective OpenAI payment stage. A staged x5/x20 upgrade therefore includes USD 0.20 for its Plus payment and another USD 0.20 for its final-tier payment.
_Avoid_: A random USD 0.20-0.50 value, one order-level allowance for a two-stage upgrade

**Card Price Unavailable**:
The pre-funding state in which no eligible card segment has a reported latest OpenAI payment for every stage required by the order. The order cannot fund a card, open a new card, or begin checkout in this state.
_Avoid_: Guessing a missing price, silently using another card segment's price

**Fresh Card Price Signal**:
A required card-segment OpenAI payment amount whose `found` value is true and whose reported payment time is no more than 72 hours old when funding is calculated.
_Avoid_: Using an undated price, treating an arbitrarily old payment as current

**Card Selection Priority**:
The deterministic order for choosing among eligible managed payment cards: first consolidate the target lane by selecting the same-lane card with the smallest funding shortfall, then consider an unassigned card, and open a new card only when neither exists.
_Avoid_: Random selection, consuming unassigned cards before reusable same-lane capacity

**Proven Card Product**:
An administrator-allowed SpaceX Card product code for which an existing card of the same product has a complete fresh card-segment price signal for every stage required by the target membership tier. Only proven card products may be opened automatically.
_Avoid_: Opening the cheapest untested product, treating an allowed product as proven without price evidence

**Funded Card Opening**:
An automatic card opening whose initial amount brings the new card to the full order budget in the same money operation. The initial amount is at least the product minimum, and the card is not opened when the required amount exceeds the product maximum or the platform balance cannot cover the opening fee and initial amount.
_Avoid_: Minimum opening followed by a second recharge, opening before the order budget is known

**Order Funding Wait**:
An order-level retry state entered before spending when the SpaceX Card platform balance cannot fund the selected existing card or a required new card. It does not fail the order or pause unrelated orders, and any no-payment card reservation is released before waiting.
_Avoid_: Permanent delivery failure, global queue pause, retaining an unfunded reservation

**Card Inventory Initialization**:
The administrator-started, resumable reconciliation that imports every owned SpaceX Card and classifies its historical fulfillment capacity before automatic card selection is enabled. A single anomalous card enters reconciliation hold without invalidating the completed cards.
_Avoid_: Blocking service startup, lazy initialization during the first customer order

**Card Inventory Reconciliation**:
The ongoing combination of signed transaction notifications and authoritative API pulls that keeps managed card status, transaction history, and capacity aligned after initialization. Notifications provide prompt signals; targeted and periodic pulls repair missing, duplicate, partial, or out-of-order events.
_Avoid_: Webhook-only accounting, polling-only delayed state

**Fulfillment Operations Console**:
The administrative view for inventory initialization, masked card scheduling state, price contracts, and evidence-gated membership-fulfillment recovery. It orchestrates safe workflow actions but is not a general SpaceX Card money-management console.
_Avoid_: Direct open-card button, direct recharge/refund button, freeze/delete controls

**Refunded Fulfillment Review**:
The reconciliation state for a membership payment that settled and was later refunded. Its card capacity is not restored automatically because the membership entitlement and card-risk effect may outlive the returned funds.
_Avoid_: Treating a refund as an authorization reversal, automatically reusing the slot

**Historical Upgrade Pair**:
The initialization-only grouping of one final x5/x20 payment with the nearest preceding unpaired Plus payment on the same card within two hours. Missing, late, or conflicting pairs cannot establish capacity automatically.
_Avoid_: Using time-based pairing for new KaWang orders, grouping every Plus payment on an upgrade card

**Checkout Region**:
The pricing and currency context used to create the ChatGPT checkout session. Automatic membership fulfillment fixes this context to the Philippines and PHP independently of the billing address source.
_Avoid_: Billing address country, card issuing area

**Checkout Price Contract**:
The versioned, administrator-approved PHP amount range for the currently displayed charge of one target membership tier. It validates checkout UI independently of the card segment's USD funding signal.
_Avoid_: Accepting any positive PHP amount, live FX conversion, treating the USD card price as the displayed PHP price

**Checkout Address Record**:
The newly generated name and Delaware address returned by KaWang's existing US-address API for one checkout autofill. It remains a US/DE billing record even though the checkout region is Philippines/PHP, and it is not bound to the reused payment card or a previous checkout.
_Avoid_: Philippines address, checkout region, persistent per-card identity

**Ephemeral Checkout Material**:
The stage-bound, short-lived bundle of full card details, fresh billing record, checkout target, and validation contract released to the owning extension installation for one active checkout attempt. It exists only in server and extension memory and is never a WebSocket payload or persistent browser record.
_Avoid_: Stored card profile, reusable checkout secret, extension-held OpenAPI credential

**Checkout Address Wait**:
An order-level retry state entered before checkout when KaWang's address API is unavailable or returns an incomplete Delaware record. Automatic fulfillment does not use a third-party address site or submit an incomplete form while waiting.
_Avoid_: Browser scraping fallback, submitting without required billing fields

**Session-Driven Checkout Entry**:
The Go checkout module locally chunks the protected order Session's `sessionToken` into allowlisted ChatGPT Cookies, verifies the authenticated account identity, reads the official current subscription, and uses the official checkout API with the extension-proven fixed `billing_details={country:PH,currency:PHP}`, hosted UI, Plus pricing-modal contract inside an isolated unattended browser. An active paid subscription stops before checkout creation; accepted responses are limited to reviewed hosted or `openai_llc/{oaics_*,cs_*}` routes, and preflight never invokes subscription renewal. It does not send the Session to a checkout-link broker or require a separately configured GPT Token.
_Avoid_: Brokered Checkout Link, legacy pricing-button automation, account password automation, treating `accessToken` as a Cookie, logging Session/Cookie material, renewing during preflight

**Unattended Checkout Browser**:
The isolated checkout browser controlled entirely by Membership Fulfillment without an operator opening, steering, or signing into it. Its rendering runtime may use a server-only virtual display, but that does not grant permission to bypass a security challenge or weaken any payment gate.
_Avoid_: Headless-only browser, operator browser, browser extension, security-challenge bypass

**Payment Stage Confirmation**:
The agreement of two independent facts for one fulfillment stage: ChatGPT reports the expected membership state and SpaceX Card reports the matching non-declined OpenAI payment. Neither browser text nor either provider signal alone completes the stage.
_Avoid_: Success-page-only confirmation, transaction-only success, plan-only success

**Provisional Payment Confirmation**:
A payment-stage confirmation whose matching card authorization is still pending while the expected membership state is already active. It consumes capacity immediately and remains under reconciliation until the authorization settles, declines, or reverses.
_Avoid_: Waiting indefinitely for settlement, treating pending authorization as final card settlement

**Lane-Bound Pending Plus Capacity**:
An OpenAI Plus authorization that is still pending on a card already bound to the Plus lane by an active fulfillment reservation. It provisionally consumes one of the card's five Plus slots without placing the card on hold; five pending/completed Plus slots make it capacity-full, while more than five or a pending authorization without a known lane still requires reconciliation hold.
_Avoid_: Treating every pending authorization as an unusable card, guessing Plus from an unbound pending charge

**Admin-Confirmed Legacy Plus Lane**:
A one-time audited classification for an active historical card that was manually used for a Plus CDK before card reservations existed. It is available only when the card is unassigned and held solely for a pending settlement; the server reclassifies the already-synced OpenAI history as Plus and enforces the five-slot capacity before making the card ready. It never calls an upstream card write operation.
_Avoid_: Inferring Plus from a last-four value, confirming x5/x20 history as Plus, bypassing transaction or capacity checks

**Payment Transaction Delta**:
The exactly one new OpenAI authorization for the expected price tier that appears on the reserved card after a stage submission and was absent from the pre-submission authorization snapshot. Zero or multiple matching transactions cannot confirm the stage automatically.
_Avoid_: Latest-transaction matching, time-only matching, reusing a pre-existing authorization

**Recognized Checkout Surface**:
A supported ChatGPT or Stripe checkout page whose origin, target plan, region, displayed amount, required fields, and final-submit control all match the versioned automation contract. Only this surface permits automatic submission.
_Avoid_: Text-scored button guessing, clicking through an unknown checkout layout

**Checkout Diagnostic Fingerprint**:
A sanitized description of an unsupported checkout state containing adapter identity, normalized navigation and pricing facts, expected-element presence, and a structural hash. It contains no page content, screenshot, form value, account identity, address, or payment credential.
_Avoid_: Raw DOM upload, automatic screenshot, form-value telemetry

**Versioned Checkout Adapter**:
The extension-bundled code contract that recognizes checkout states, fields, progression controls, and the final payment control for a known UI version. It can change only through an extension release, never through remotely supplied selectors or executable code.
_Avoid_: Server-configured click rules, remote JavaScript, text-only button matching

**Automatic Checkout Rollout Gate**:
The production control that keeps final payment activation disabled until no-charge validation and explicitly scoped live canaries have passed. Full automation capability may be deployed while this operational gate remains closed.
_Avoid_: Enabling every order on deployment, confusing dry-run success with payment success, permanently manual checkout

**No-Charge Checkout Validation**:
A rollout check that verifies account eligibility, checkout creation, target plan, PH/PHP price contract, initial-page structure, and field recognition without selecting or reserving a final card, moving funds, releasing card credentials, or activating any post-card control.
_Avoid_: Real-card autofill, clicking Next, treating initial-page coverage as multi-step coverage

**Live Canary Authorization**:
An administrator's freshly authenticated, explicit permission for one identified redeem order and payment stage to activate final payment while broad automatic checkout remains disabled. It is not a percentage rollout or an implicit product-wide permission, and the system executing the payment cannot grant it to itself.
_Avoid_: Random canary selection, automatic scope expansion, treating deployment as approval, worker self-approval

**Canary Approval Snapshot**:
The single-use immutable facts authorized for one live-canary payment: order, target tier, selected card, funding budget, checkout price-contract version, and extension adapter version. A changed fact invalidates the approval, and final payment activation consumes it atomically.
_Avoid_: Permanent approved flag, time-window replay, approval surviving a changed payment plan

**Canary Approval Hold**:
The maximum 15-minute browser-lease period in which a prepared live-canary stage waits for its matching approval snapshot. Expiry releases the sanitized browser context and invalidates the page snapshot without releasing card capacity, moving funds, or replaying an already completed stage.
_Avoid_: Indefinite global queue pause, approval surviving a rebuilt page, repeating Plus after an upgrade hold expires

**Tier Rollout Qualification**:
The independently earned permission prerequisite for broad automation of one versioned Plus, x5, or x20 checkout path and PHP price contract, established by one complete live canary whose card payment settles, target membership confirms, renewal is disabled, and exercised adapter path has no unresolved outcome. Tiers progress in order from Plus to x5 to x20 after that single-canary threshold; qualification never enables a scope by itself or carries into another tier or contract version.
_Avoid_: Plus qualifying x5/x20, simultaneous tier rollout, pending authorization as rollout proof, requiring an unstated multi-day observation gate, automatic promotion, reusing evidence across versions

**Automatic Checkout Scope**:
An audited, freshly authenticated permission for one exact site, product, target tier, qualified adapter version, and PHP price-contract version, bounded by a daily order limit and USD risk budget. It applies only to eligible orders created after its activation time; a contract-version change pauses it, while disabling it stops new money movement without abandoning fulfillments that already crossed the funding boundary.
_Avoid_: Unscoped master enablement, retroactive backlog activation, qualification as automatic enablement, inheriting approval across contract versions, terminating paid reconciliation on disable

**Automatic Checkout Daily Risk Budget**:
The maximum combined snapshotted payment budget and provider funding fees that one automatic-checkout scope may move into money-bearing execution during a business day. It counts full payment exposure even when an existing card balance avoids a recharge, and each fulfillment consumes it only once.
_Avoid_: Counting only recharge amounts, recounting x5/x20 upgrade stages, restoring exposure after an uncertain or paid outcome

**Fulfillment Dependency Circuit**:
The scoped safety gate that blocks new money movement when a shared provider or one versioned checkout path is unhealthy. Order-specific failures stay local, while already funded or paid fulfillments retain read-only reconciliation and renewal-protection access.
_Avoid_: Continuing new payments through a shared outage, global pause for one bad account, abandoning paid reconciliation

**Checkout Progression Control**:
An allowlisted non-payment control on a recognized multi-step checkout that advances from card or billing entry to the next expected checkout state. It is distinct from the final payment control and cannot be identified from button text alone.
_Avoid_: Final payment control, generic Continue-button clicking, assuming every checkout is one page

**Pre-submit Checkout Failure**:
A checkout failure for which the adapter proves that no final payment control was activated, membership did not change, and no new card transaction appeared. It may reuse the same reserved funded card without another funding operation.
_Avoid_: Uncertain payment outcome, switching cards, recharging on a form error

**Unexpected Checkout Preauthorization**:
Any new card transaction, including a zero- or small-value verification authorization, that appears after an intermediate checkout action but before the allowlisted final payment control is activated. It blocks further automatic checkout until its outcome and UI behavior are explicitly reconciled.
_Avoid_: Ignoring small authorizations, treating every `$0` or `$1` event as harmless, continuing to final payment

**Recognized Plan Management Surface**:
The versioned ChatGPT account page on which an already-confirmed Plus membership exposes the allowlisted control for changing to x5 or x20. It is the only automatic entry into the final stage of a staged membership upgrade.
_Avoid_: Direct final-tier checkout link, text-scored upgrade button, arbitrary homepage navigation

**Payment Action Required**:
A fulfillment state in which a recognized payment flow requires 3DS, CAPTCHA, bank verification, or another human action. The active browser page and card reservation are retained, the shared incognito activation queue pauses globally, and resumption performs confirmation only rather than another payment submission.
_Avoid_: Bypassing the challenge, switching cards, resubmitting payment after handoff

**Human Challenge Acknowledgement**:
The local extension action by which an operator confirms that they finished interacting with the retained incognito challenge page. It authorizes confirmation queries only and never authorizes another checkout submission.
_Avoid_: Remote blind resume, automatic DOM-based acknowledgement, treating acknowledgement as payment success

**Lost Challenge Context**:
A human-required checkout whose owning incognito tab, window, or browser no longer exists. Its order remains under server-side membership and transaction reconciliation while the sanitized extension queue may continue with another order.
_Avoid_: Recreating and resubmitting checkout, releasing the card reservation, permanently blocking the browser queue

**Uncertain Payment Outcome**:
A fulfillment state in which a submitted payment lacks complete payment-stage confirmation. The order and card reservation await reconciliation and must not submit the same payment again automatically.
_Avoid_: Treating timeout as failure, blind payment retry

**Evidence-Gated Reconciliation**:
The resolution rule under which an uncertain fulfillment can consume or release capacity only from authoritative membership and card-transaction facts. Operator intent may request another check but cannot override contradictory or incomplete evidence.
_Avoid_: Force-success button, force-release button, timeout-based assumption

**No-Transaction Observation Window**:
The 24-hour evidence period after a recorded final payment activation in which repeated authoritative checks must continue to show the pre-stage membership and no new or pending OpenAI transaction. Passing the window only enables an operator-reviewed no-payment resolution; it never releases capacity automatically.
_Avoid_: Treating the five-minute poll as final proof, automatic timeout release, a single negative query

**Explicit Payment Decline**:
A submitted payment whose new matching card transaction is `DECLINED` while membership remains at its verified pre-stage state and reconciliation finds no other effective payment. It is a known non-payment outcome, but it never authorizes an automatic card switch or resubmission.
_Avoid_: Uncertain payment outcome, automatic decline retry, deleting or freezing the card

**Partial Membership Fulfillment**:
An x5/x20 fulfillment whose Plus stage is confirmed but whose final upgrade has not completed and cannot continue automatically, such as after an explicit final-stage decline. Its paid-stage evidence and card reservation remain intact for external resolution and later evidence recheck; Plus renewal may remain enabled only during the bounded resolution window and is disabled at its safety deadline without changing the fulfillment outcome.
_Avoid_: Releasing the slot, reporting the target tier complete, repeating Plus, allowing temporary Plus renewal exposure to become an unintended renewal

**Expired Partial Membership Fulfillment**:
A terminal partial fulfillment in which the confirmed intermediate Plus membership expired before the ordered x5/x20 tier was established. Its paid evidence and card capacity remain accounted for, while the customer outcome requires an explicit compensation resolution outside automatic payment fulfillment.
_Avoid_: Automatic Plus repurchase, releasing paid capacity, reporting x5/x20 success, leaving the customer outcome unowned

**Customer Compensation Resolution**:
An append-only audited record of how an operator resolved the customer impact of an expired partial membership fulfillment: an external refund, an external replacement delivery, or the customer's acceptance of the partial result. It records the responsible operator, time, and evidence reference without changing the underlying payment truth or performing a money operation.
_Avoid_: Reopening the expired fulfillment, automatic refund or replacement payment, overwriting an earlier resolution

**Customer Delivery Result**:
The safe customer-facing projection of membership-fulfillment truth. Only renewal-safe completion is a successful delivery; partial fulfillment remains in human or after-sales handling until an audited compensation resolution supplies the corresponding non-success outcome.
_Avoid_: Reporting success from session activation, reporting x5/x20 from intermediate Plus, exposing payment internals to the customer

**Fulfillment Intervention Alert**:
A deduplicated, sanitized operations-console task and Feishu notification indicating that a membership fulfillment needs human attention. It identifies the normalized problem and required action without serving as payment evidence or changing fulfillment state.
_Avoid_: Notification per worker retry, secrets in messages, treating acknowledgement as workflow approval

**Membership State Provider**:
The authorized `gptserve.freespaces.app` service that receives an order's protected ChatGPT Session from kwRedeem and reports the current account type for payment-stage confirmation. The extension never calls it or receives the Session used for the query.
_Avoid_: Browser-side membership query, persisting the provider's raw response

**Confirmed Account Type**:
The allowlisted membership type reported by the membership state provider: `free` for no paid membership, `plus` for Plus, `prolite` for x5, and `pro` for x20. Any missing or unknown value is contract drift rather than evidence of a free account.
_Avoid_: Expecting `x5` or `x20` from the provider, treating null or an unknown enum as free, using UI labels as API enums

**Eligible Starting Membership**:
A ChatGPT account state that may enter automatic card fulfillment: either free, or delinquent with renewal disabled and a recognized initial Plus checkout surface proving replacement purchase is currently available. A healthy existing paid membership and a delinquent account that cannot yet reach that checkout are not eligible starting states.
_Avoid_: Treating delinquency alone as purchase eligibility, waiting only on a guessed expiry, replacing a healthy paid plan

**Account Repurchase Wait**:
The no-funding state for a renewal-protected delinquent account that cannot yet produce a recognized Plus checkout surface with the required plan, region, currency, and amount. It may be rechecked, but it cannot open or fund a card.
_Avoid_: Assuming `is_delinquent` means purchasable, funding before checkout eligibility is proven

**Renewal-Safe Completion**:
A confirmed final membership whose newly enabled automatic renewal has been disabled and rechecked before the redeem order completes. An x5/x20 fulfillment does not disable renewal during its intermediate Plus stage.
_Avoid_: Completing while auto-renew remains enabled, cancelling between staged-upgrade payments
