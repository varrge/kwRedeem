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

**Shake Card**:
A single-use entitlement to participate in one Shake & Win draw. It is granted when a player satisfies an eligibility rule and remains valid independently of later changes to that rule.
_Avoid_: Rechecking eligibility when the player draws, treating qualification progress itself as a draw attempt

**Shake Card Tier**:
The configured grade of a Shake Card: low, medium, or high. An eligibility rule or manual grant issues one explicit tier, a draw consumes the tier selected by the player, and an extra-draw prize returns the same tier that was consumed. Legacy untyped cards and configuration are treated as low tier.
_Avoid_: Deriving tier from prize rarity, silently consuming a different available tier, upgrading legacy cards during migration

**Shake Card Earning Source**:
The configured category of qualifying consumption that can grant Shake Cards. The first release supports purchases made through the KaWang Subscription Center and actual Sub2api balance consumption.
_Avoid_: Balance recharge, balance-code redemption, invite rebate, World Cup balance change

**Shake Subscription Group Grant Rule**:
An administrator-configured mapping from one Sub2api subscription group ID to a Shake Card tier and fixed quantity. A successfully completed KaWang subscription order applies the mapping to the order's stored group snapshot exactly once; an unmapped group grants no card.
_Avoid_: Accumulating plan price, matching by plan display name, remote group lookup after purchase, granting one order more than once

**Shake Subscription Group Usage Rule**:
An administrator-configured mapping from one Sub2api subscription group ID and an Actual Sub2api Balance Consumption threshold to a Shake Card tier. Official usage rows with a `subscription_id` accumulate by user and `group_id`; non-subscription usage is handled separately by the optional unscoped balance-consumption rule.
_Avoid_: Sharing progress between groups, treating a plain group_id as proof of subscription usage, counting one usage row in both rule types, inferring a group from the user's current subscriptions

**Shake Card Consumption Classification**:
Each qualifying consumption belongs to exactly one Shake Card earning source. A KaWang Subscription Center purchase counts only as subscription purchase consumption and is excluded from actual Sub2api balance consumption progress.
_Avoid_: Counting one balance deduction toward both earning sources

**Actual Sub2api Balance Consumption**:
A qualifying remote Sub2api consumption entry with a stable source identity, excluding KaWang subscription purchases, balance acquisition, redeem codes, invite rebates, World Cup balance changes, Shake & Win rewards, and administrator adjustments. Progress advances only from synchronized source records and is never inferred from balance differences.
_Avoid_: Net balance delta, recharge amount, duplicated remote history entry

**Shake Consumption Sync Cursor**:
The per-connection checkpoint used to import new Actual Sub2api Balance Consumption records without duplication. Administrators can inspect sync errors and request a catch-up sync, while imported source identities make repeated synchronization idempotent.
_Avoid_: Full untracked rescans, silently skipping failed sync windows

**Shake Card Rolling Progress**:
Qualifying consumption grants one Shake Card for every complete configured threshold crossed, including multiple cards when one increment crosses multiple thresholds. Any amount below the next threshold remains as progress toward a future card.
_Avoid_: Granting at most one card per consumption event, discarding progress remainder, one-time lifetime milestones

**Prospective Shake Card Rule**:
A Shake Card earning rule that applies only to qualifying consumption recorded after that rule version takes effect. Existing Shake Cards and progress remainders retain the terms under which they were earned when a rule is later changed.
_Avoid_: Retroactively rescanning consumption, recalculating issued cards after a threshold change

**Manual Shake Card Grant**:
An administrator-issued Shake Card for a specific player, used for migration, customer support, or compensation and recorded with its administrative reason.
_Avoid_: Editing consumption progress to simulate a grant, unrecorded compensation

**Shake & Win Campaign**:
A separately scheduled activity that owns its eligibility rules, prize pool, Shake Cards, and draw records. It moves through draft, scheduled, active, and ended states, and a Sub2api connection may have at most one active campaign at a time.
_Avoid_: One mutable global lottery configuration, overwriting a previous campaign

**Campaign-Bound Shake Card**:
A Shake Card issued for one Shake & Win Campaign and redeemable only while that campaign is active. Unused cards expire when the campaign ends and cannot be migrated to another campaign.
_Avoid_: Cross-campaign cards, carrying cards forward, silently extending card validity

**Shake Prize**:
A campaign-configured outcome created and managed by an administrator in the Shake & Win admin system, rather than a hard-coded frontend segment. The first release supports fixed Sub2api balance rewards, an extra Shake Card draw, and a zero-value “谢谢参与” outcome; each prize has an admin-defined name, display metadata, amount where applicable, probability weight, sort order, and enabled state, with no daily or total inventory limit.
_Avoid_: Physical fulfillment, coupon issuance, manually promised rewards without a draw outcome

**Shake Prize Pool**:
The set of enabled, unlimited-inventory Shake Prizes available for selection in a campaign. Its displayed size is the number of enabled prize types, not the number of remaining awards.
_Avoid_: Finite prize stock, remaining-award counter

**Shake Prize Weight**:
An administrator-defined nonnegative relative weight set independently for low, medium, and high Shake Cards. Every tier must have at least one enabled prize with positive weight; the resulting percentage is shown for the selected tier, and each draw records its card tier and complete prize-pool weight snapshot so later changes do not alter history.
_Avoid_: Requiring weights to total 100, sharing one forced probability across all tiers, hard-coded frontend odds, recalculating historical odds

**Shake Configuration Version**:
An immutable snapshot of a campaign's eligibility or prize configuration that takes effect for future consumption or draws. Administrators may change an active campaign by creating a new version, while historical grants and draws retain their original version.
_Avoid_: Editing historical outcomes in place, applying a new configuration retroactively

**Shake Draw**:
The server-determined, immutable result of consuming one Shake Card against a specific prize-pool version. The client animates the recorded result but never selects or rerolls it.
_Avoid_: Client-side prize selection, changing a result after refresh or delivery failure

**Case Opening Reveal**:
The Shake & Win draw presentation in which a horizontal track of configured prize items accelerates, travels beneath a fixed center marker, decelerates, and lands on the server-recorded result. It is a visual reveal only and never determines the prize.
_Avoid_: Prize wheel, client-selected stopping position, automatic follow-up draw

**Case Opening Track**:
The visual sequence used by the Case Opening Reveal, built by cycling through enabled prize types without repeating items in proportion to their probability weights. Actual weights are disclosed separately in the campaign rules.
_Avoid_: Encoding probability through visible item repetition, presenting the animation as the random selector

**Shake Prize Rarity**:
An administrator-selected presentation tier for a Shake Prize: common, rare, epic, or legendary. It controls the prize card's color, reveal emphasis, lighting, and sound but has no effect on its probability weight.
_Avoid_: Deriving probability from rarity, hard-coding rarity from reward amount

**Pending Shake Reward**:
A fixed Shake Draw result whose Sub2api balance reward has not yet been confirmed as delivered. Delivery retries use the draw identity as their idempotency identity and never consume another card or select another prize.
_Avoid_: Refunding the draw for a reroll, issuing a different prize after timeout, duplicate balance credit

**Shake Reward Disposition**:
An audited administrator action on the delivery state of a fixed Shake Draw, such as retrying delivery, confirming externally verified delivery, or voiding an undeliverable reward with a reason. It never changes the selected prize, and voiding does not automatically reverse a balance reward already credited remotely.
_Avoid_: Editing a winning result, unaudited manual completion, automatic clawback on void

**Sub2api User Tutorial**:
A publicly readable learning unit embedded in the Sub2api experience that explains how a user calls the API or purchases a configured subscription plan.
_Avoid_: Operator runbook, administrator manual, generic public documentation

**Tutorial Center**:
The embedded Sub2api page that organizes and presents Sub2api user tutorials; its first release covers API calling and subscription purchasing only.
_Avoid_: Admin console, helpdesk ticket system, unrestricted documentation portal

**Tutorial Track**:
An ordered group of Sub2api User Tutorials within the Tutorial Center that leads a user through one outcome; the first tracks are API Calling and Subscription Purchase.
_Avoid_: One long undifferentiated article, administrator workflow, subscription product catalog

**Tutorial Content**:
The explanatory material that makes up a Sub2api User Tutorial, maintained as a reviewable project artifact in the first release.
_Avoid_: Runtime user data, administrator settings, unversioned pasted copy

**Tutorial Metadata**:
The title, slug, track, ordering, visibility, and related navigation information that describes Tutorial Content independently from its body.
_Avoid_: Formatting markup, user completion state, hard-coded page order

**Tutorial Home**:
The public landing content rendered directly by Sub2api at its root in place of the default homepage; it introduces the service while deferring account-specific actions to the existing Sub2api sign-in flow.
_Avoid_: Replacing the entire Sub2api application shell, administrator dashboard, authenticated account home

**Account-Gated Tutorial Action**:
An action reached from public tutorial content that requires Sub2api SSO before reading user-specific data or purchasing a subscription, such as “购买订阅” or “我的套餐”.
_Avoid_: Requiring login to read tutorials, anonymous purchase, exposing the Sub2api admin token

**Subscription Center**:
The authenticated Sub2api experience that shows available subscription plans and a user's purchase records, and lets the user purchase a configured plan with their remote balance.
_Avoid_: Tutorial article, anonymous checkout, administrator plan editor

**Subscription Purchase Tutorial**:
The Tutorial Track that explains how to compare a plan's price, validity, and quota before handing the user to the authenticated Subscription Center; it does not perform the balance deduction itself.
_Avoid_: Embedded checkout, administrator subscription assignment, plan configuration manual

**API Quickstart**:
The first Tutorial Track outcome in which a user configures the service endpoint and credential, sends one valid API request, and verifies a successful response.
_Avoid_: Complete API reference, theoretical overview, provider-specific setup

**API Quickstart Protocol**:
The OpenAI-compatible `/v1/chat/completions` contract used as the Tutorial Center's first-call baseline; other protocols and clients are documented as separate recipes.
_Avoid_: Claiming every model supports one identical protocol, mixing provider-specific request bodies into the baseline

**Unified API Access**:
The user-facing capability of using one Sub2api-issued API Key and endpoint configuration across the compatible clients and model routes documented by the Tutorial Center.
_Avoid_: Promising every client or model is interchangeable, exposing upstream provider credentials, treating subscription purchase as API access itself

**Client Integration Recipe**:
A focused tutorial that maps the KaWang API contract to one client category—CLI, SDK, desktop application, web tool, or third-party service—and states its configuration, verification, and credential-safety boundaries.
_Avoid_: Unverified software list, implicit official endorsement, copying secrets into unknown tools

**Direct Client Connection**:
A Client Integration Recipe in which a compatible application such as CodexG or CCGUI receives the Sub2api Base URL, API Key, and model name and calls the OpenAI-compatible API itself.
_Avoid_: Upstream provider credential, hidden local proxy, assuming every client field uses the same URL shape

**Managed CLI Connection**:
A Client Integration Recipe in which a graphical workspace such as CodexG or CCGUI launches an already configured Claude Code, Codex CLI, or Gemini CLI runtime that connects to Sub2api.
_Avoid_: Duplicating a Key into both layers without need, describing the GUI as the API caller, mixing runtime-specific protocols

**CC Switch Recipe**:
A Client Integration Recipe in which CC Switch stores a Sub2api user API Key and exposes a local route consumed by a client such as CCGUI or CodexG, with explicit Base URL path handling and a Codex protocol-conversion warning.
_Avoid_: Using a Sub2api admin token, duplicating `/v1`, treating CC Switch OAuth as an API Key, claiming every CC Switch preset supports the same protocol

**Client Support Tier**:
The tutorial label that distinguishes project-maintained examples, recently verified compatible clients, and unverified community options without implying equal support or endorsement.
_Avoid_: Undifferentiated recommendation list, permanent compatibility claim, hidden support boundary

**Client Verification Record**:
The evidence attached to an “已验证兼容” Client Support Tier, including the tested client version, protocol/configuration, verification date, and known limitations.
_Avoid_: Vendor claim as proof, timeless compatibility, verification with an administrator credential

**Credential-Safe Tutorial**:
A Tutorial Center experience that teaches credential use with placeholders and links to the authenticated Sub2api console, but never reads, stores, or renders a user's real API Key.
_Avoid_: Auto-filled secrets, temporary tutorial credentials, exposing keys in an iframe

**Store Fulfillment Order**:
A paid Dujiao store order awaiting or undergoing delivery, from which KaWang issues the buyer-facing CDK promised by the mapped product.
_Avoid_: KaWang redeem order, activation job

**Manual-Processing CDK**:
A KaWang redeemable card whose eventual redemption creates work for an operator instead of starting automatic activation.
_Avoid_: Source key, automatically activated CDK, fulfillment record

**SpaceX CDK**:
A one-time upstream SpaceX Card credential for a fixed membership plan. KaWang allocates it during store fulfillment and keeps the full value server-side rather than delivering it directly to the buyer.
_Avoid_: KaWang activation code, card number, reusable inventory key

**KaWang SpaceX Activation CDK**:
The buyer-visible KaWang code that wraps exactly one SpaceX CDK. Dujiao delivers this wrapper, and the player submits it on the KaWang frontend to activate the corresponding membership plan.
_Avoid_: Exposing the SpaceX CDK to the buyer, sharing one SpaceX CDK across wrappers, manual-processing CDK

**SpaceX Activation Prefix**:
The buyer-visible plan marker on a KaWang SpaceX Activation CDK: `91GPTPLUS` for Plus, `91GPT5X` for Pro x5, and `91GPT20X` for Pro x20. The prefix mirrors the bound SpaceX CDK plan and does not change it.
_Avoid_: Inferring the upstream plan from a product title, using one prefix for every plan

**Proxied SpaceX CDK Activation**:
The automatic activation flow started when a player submits a KaWang SpaceX Activation CDK together with the target account's ChatGPT Session. KaWang keeps the bound SpaceX CDK server-side and performs the upstream preview, preflight, redeem, and result checks on the player's behalf.
_Avoid_: Revealing the SpaceX CDK, sending the player to redeem it manually, routing the request through the retired Go checkout automation

**Ephemeral SpaceX Activation Session**:
The player's raw ChatGPT Session used only in memory while KaWang obtains preflight and submits the upstream redeem request. KaWang discards it after upstream acceptance and persists only the masked account identity, stable client request identity, and upstream tracking data; an interruption before acceptance requires the same account to resubmit a Session.
_Avoid_: Persisting the raw Session, logging it, reusing it for another activation, retaining it for result polling

**SpaceX Activation Claim**:
The one-account claim created only after SpaceX preflight accepts the player's ChatGPT Session. Invalid Session or failed preflight leaves the KaWang SpaceX Activation CDK unused; after a claim, the wrapper cannot be moved to another ChatGPT account while activation is unresolved.
_Avoid_: Consuming a code before preflight, switching accounts after preflight, treating a frontend submission as a successful claim

**Pending SpaceX Activation**:
A claimed activation whose upstream result is `queued`, `running`, `review`, or `pending`. It remains bound and non-resubmittable until an authoritative result changes it.
_Avoid_: Releasing the wrapper, submitting another redeem request, reporting activation success

**SpaceX Activation Result Sync**:
KaWang's authoritative local projection of an upstream SpaceX activation. Verified Webhooks update it idempotently by stable event ID, low-frequency order reconciliation repairs missed events, and the player frontend reads only the KaWang projection.
_Avoid_: Browser polling SpaceX directly, Webhook-only truth, treating duplicate or out-of-order events as new redemption attempts

**Failed SpaceX Activation Resolution**:
The operator-owned resolution required when a claimed activation reaches an upstream terminal failure such as `declined`, `failed_precharge`, or `cancelled`. KaWang does not automatically release the wrapper or move it to another account.
_Avoid_: Blind automatic retry, silent wrapper reset, discarding the account binding

**Uncertain SpaceX CDK Issuance**:
A store-fulfillment state in which SpaceX may have issued and charged for a CDK but KaWang did not durably receive its full value. The store order remains undelivered and requires operator reconciliation; KaWang never issues an automatic replacement because the upstream list cannot recover the full code.
_Avoid_: Retrying with a new idempotency key, delivering an unbacked wrapper, assuming a timeout means no CDK was issued

**Uncertain SpaceX Issuance Resolution**:
The audited super-administrator procedure for closing an uncertain issuance. A provider-confirmed absence may resume with the original idempotency key; a provider-confirmed issued code whose full value was lost must first be deleted and refunded before a newly authorized recovery key may replace it; otherwise the store order is refunded without replacement.
_Avoid_: Operator replacement without evidence, leaving the old code live, marking an unbacked wrapper delivered

**SpaceX Issuance Unit**:
One purchased store unit with exactly one allocated SpaceX CDK and exactly one KaWang SpaceX Activation CDK. It first consumes matching reusable inventory; when new upstream issuance is required, that unit has its own stable issuance idempotency key so an uncertain result is isolated to the unit.
_Avoid_: One shared SpaceX CDK for multiple units, buying a new code while matching reusable inventory exists, changing the idempotency key on retry

**Complete SpaceX Store Delivery Set**:
The full set of KaWang SpaceX Activation CDKs promised by one store fulfillment target. Dujiao receives the set only after every issuance unit has a durable one-to-one binding; an uncertain unit blocks delivery of the whole set.
_Avoid_: Partial buyer delivery, omitting an uncertain unit, replacing the whole set after one unit fails

**Protected SpaceX CDK Secret**:
The encrypted full value of a SpaceX CDK. Routine admin views, APIs, and logs expose only its prefix and lifecycle state; only a super administrator who passes fresh verification and supplies a reason may reveal it temporarily, with an immutable audit record.
_Avoid_: Plaintext database storage, routine admin display, logging full codes, unaudited reveal

**Reusable SpaceX CDK Inventory**:
SpaceX CDKs detached from permanently invalidated buyer-facing wrappers that never reached an activation claim and whose authoritative upstream state is currently `unused`. A later store fulfillment transactionally allocates verified inventory for the exact same plan before purchasing another SpaceX CDK; inability to verify inventory pauses fulfillment instead of triggering a new purchase.
_Avoid_: Reusing the invalidated KaWang wrapper, trusting local state alone, allocating across plans, buying new matching inventory first

**Pre-Activation SpaceX Wrapper Refund**:
A store refund that permanently invalidates the buyer-visible KaWang SpaceX Activation CDK without deleting or refunding its upstream SpaceX CDK. The detached upstream code returns to reusable inventory for a future purchase of the same plan.
_Avoid_: Reactivating the refunded wrapper, deleting the upstream code, purchasing replacement inventory before reallocation

**SpaceX Activation-Refund Race**:
The serialized decision between an activation claim and a refund hold on the same KaWang SpaceX Activation CDK. The first committed lock wins: a refund hold prevents preflight and may reclaim an authoritatively unused upstream code, while an existing activation claim blocks automatic inventory reclamation and requires operator resolution.
_Avoid_: Refund and activation both succeeding, reclaiming a claimed code, allowing activation through an existing refund hold

**Outstanding SpaceX Funding Liability**:
The sum of each active SpaceX CDK's immutable bounded funding cap or explicitly accepted snapshot-budgeted liability. KaWang treats this amount as already committed even though SpaceX deducts the actual funding only when a player redeems a code.
_Avoid_: Counting only currently activating codes, using the eventual actual charge as the pre-sale commitment, ignoring reusable inventory, summing an unlimited upstream cap as zero

**Authoritative SpaceX Funding Cap**:
The strictly positive, bounded `owner_funding_cap_minor` and currency returned by SpaceX for an individually issued CDK, either in the one-time issuance response or its immediate read-after-write list record, and stored as an immutable local snapshot. Their presence is a hard issuance contract; KaWang blocks `spacex_cdk` fulfillment when either value is absent rather than estimating future liability.
_Avoid_: Locally guessed caps, mutable plan defaults as historical truth, accepting a fee-only issuance response, treating an unlimited zero cap as zero liability

**Unbounded SpaceX Funding Authorization**:
A SpaceX CDK contract whose read-after-write record reports `owner_funding_cap_minor=0` together with `unlimited_cap=1`. KaWang records and labels this provider state explicitly; it remains blocked unless the owner has explicitly enabled snapshot-budgeted acceptance.
_Avoid_: Reporting the contract as merely missing, summing it as zero liability, silently enabling delivery, presenting a local budget as an upstream cap

**Snapshot-Budgeted SpaceX Funding Liability**:
The immutable positive `open_and_balance_minor` amount and currency from an unbounded SpaceX CDK's issuance snapshot, accepted by explicit owner policy as KaWang's local liability budget. It permits wrapper delivery without claiming to limit the upstream authorization or guarantee the eventual charge.
_Avoid_: Authoritative funding cap, zero liability, live recalculation, hidden risk override

**Funding-Covered SpaceX Fulfillment**:
A store fulfillment for which the current SpaceX account balance, after subtracting outstanding funding liabilities and the new issuance service fee, still covers the new CDK's bounded cap or accepted snapshot budget. If not, KaWang blocks new issuance and delivery so funds remain available for previously sold codes.
_Avoid_: Selling first and checking balance at player activation, treating a warning as funding coverage, spending committed balance on new issuance

**SpaceX CDK Rollout Gate**:
The disabled-by-default production permission for `spacex_cdk` fulfillment. After simulated-provider verification, one explicitly authorized quantity-one Plus store order must prove issuance, wrapping, delivery, activation, result sync, and funding liability before x5 and then x20 may be enabled; real SpaceX API tests require separate owner authorization.
_Avoid_: Enabling all plans together, treating test doubles as live proof, reusing the retired Go checkout rollout state

**Voided CDK Queue Cancellation**:
When an administrator voids a redeemed CDK, KaWang atomically cancels its still-pending activation job, Session Activation Delivery, redeem order, and pre-exposure Membership Fulfillment. A task already processing an external activation, holding a browser lease or card reservation, or entering the funding/payment boundary blocks the void action instead of pretending that in-flight work was cancelled. Completed delivery truth remains unchanged.
_Avoid_: Voiding only the CDK row, reviving a cancelled queue item, discarding payment or reservation evidence

**Store Product Mapping**:
An explicit association from a Dujiao product and optional SKU to the fulfillment kind, promised plan, KaWang site, and public prefix of the CDK the purchase delivers.
_Avoid_: Product-title matching, implicit prefix matching

**SpaceX CDK Fulfillment Mode**:
The explicit `spacex_cdk` store-product fulfillment kind that allocates and wraps a SpaceX CDK for each newly created fulfillment unit, reusing eligible matching inventory before new issuance. Only mappings deliberately switched to this mode use it; existing tasks retain their snapshotted manual-processing contract.
_Avoid_: Reinterpreting every Plus/x5/x20 manual mapping, changing historical tasks during retry, inferring the mode from a prefix

**Store Connection**:
The single Dujiao store that KaWang observes and fulfills using a dedicated service administrator.
_Avoid_: KaWang site, Sub2api connection, buyer account

**Order-Issued CDK**:
A new buyer-facing KaWang CDK created specifically for one purchased unit in a store fulfillment order rather than selected from pre-existing card inventory. For SpaceX fulfillment, it is a KaWang SpaceX Activation CDK bound one-to-one to an allocated SpaceX CDK, whether reused or newly issued.
_Avoid_: Stock CDK, shared CDK, reusable CDK

**Store-Delivered CDK**:
An order-issued CDK whose value has been confirmed in the Dujiao fulfillment but remains redeemable in KaWang until the buyer submits it for its mapped activation flow.
_Avoid_: Used CDK, completed activation

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
A payment card from one Card Platform whose provider-scoped identity and operational metadata are tracked by KaWang for Membership Fulfillment. Full payment credentials are not part of KaWang's card inventory.
_Avoid_: Stored card credentials, disposable checkout payload

**Card Platform**:
An external card service adapted into Membership Fulfillment through normalized card inventory, funding, ephemeral credential-release, and transaction capabilities. A platform supplies card facts and operations but never owns fulfillment state or payment authorization.
_Avoid_: Card-platform-specific membership workflow, card supplier owning fulfillment state, Card Platform Adaptation

**Card Platform Connection Identity**:
The credentials and endpoint that identify one configured Card Platform account. It is immutable while that platform has a reserved capacity claim or an unresolved Funding Intent, so recovery and reconciliation continue against the same external account.
_Avoid_: Rotating platform credentials during funding, falling through to another platform after reservation

**Session Activation Delivery**:
The existing extension process that installs an order's ChatGPT authentication cookies into the incognito store, verifies identity, and completes the starting subscription-protection check before activating the already-issued CDK. Its success does not mean that a membership was purchased.
_Avoid_: Membership fulfillment, payment completion

**Session Activation Renewal Guard**:
The one-time protection and eligibility prerequisite evaluated from the player's submitted Session during CDK activation: confirm that no paid subscription remains active and observe whether the account is set to renew automatically. When renewal is enabled, disable and recheck it; when a paid subscription remains active after renewal is disabled, keep the wrapper unclaimed and let the same account submit again after expiry. An unconfirmed status or cancellation blocks activation and moves to bounded recovery or human handling; this guard belongs to Session Activation Delivery and is separate from the final renewal protection owned by Membership Fulfillment.
_Avoid_: Go checkout renewal guard, recurring subscription management, browser-side renewal toggle, treating auto-renew-off as an expired subscription, continuing after an ambiguous cancellation

**Session Activation Renewal Recovery**:
The evidence-based operator path for a renewal guard that cannot confirm the disabled state automatically. It may re-query or perform a bounded retry for the same preflight-verified account, but it cannot assert success, bypass the guard, or restore automatic renewal through KaWang.
_Avoid_: Force-complete, manual success flag, automatic renewal rollback

**Membership Fulfillment**:
The independent, durable order process started after a player's card code is accepted and its protected ChatGPT Session is submitted. It passes the Starting Subscription Guard before establishing the browser Session, completes the purchased membership's payment stages, confirms the target membership, and disables renewal again before completion; it alone owns card, payment, upgrade, and renewal-safe completion state.
_Avoid_: Automation Protocol, card-platform workflow, overloading session activation status, using the redeem order's generic status as payment state

**Starting Subscription Guard**:
The initial membership-fulfillment check performed with the submitted Session before establishing its checkout browser Session. It queries the subscription, disables automatic renewal when enabled, and then requires a fresh authoritative observation showing both `plan=free` and automatic renewal disabled before checkout may begin.
_Avoid_: Pre-payment cancellation, treating cancellation success as purchase eligibility, paying while a paid plan remains active, inferring `free` or renewal state from a missing response

**Starting Subscription Dependency Wait**:
The retry state when subscription query or renewal cancellation is temporarily unavailable during the Starting Subscription Guard while the Session has not been proven invalid. The original order retains its locked CDK, performs no card or money action, and retries with bounded backoff; exhausting automatic retries requires human handling and does not release the CDK.
_Avoid_: Treating timeout or rate limiting as an invalid Session, releasing the CDK on an unknown result, entering checkout without authoritative subscription evidence

**Pre-Funding Session Release**:
The recovery outcome when a submitted Session becomes unusable before any card reservation, funding, authorization, or payment action. The current order and fulfillment are terminally cancelled, the locked CDK returns to `active`, and the player's next submission creates a new order and fulfillment with no Session or account state inherited from the cancelled attempt.
_Avoid_: Resuming the cancelled order with a replacement Session, overwriting the failed attempt, releasing a CDK after money exposure

**Post-Funding Session Recovery**:
The recovery path when a Session becomes unusable after card reservation or money exposure. The CDK and original order remain locked; the player submits the order number, original CDK, and replacement Session through a dedicated recovery entry, and that Session may replace only the encrypted Session of the same verified ChatGPT identity. Membership tier, card, stage, and evidence remain immutable, reconciliation runs first, and another payment is allowed only when there is authoritative evidence of no membership change, no effective charge, and no pending authorization.
_Avoid_: Resetting the CDK, creating a replacement order, accepting a different account, retrying payment before reconciliation

**Membership Financial Exposure Boundary**:
The irreversible fulfillment boundary crossed as soon as a specific payment card is reserved for the order, an open-card or funding request is submitted, full card material is released to checkout, a possibly authorizing checkout control is activated, or any related card transaction appears. After any one of these events, the original order retains the CDK and all recovery proceeds through reconciliation even when no successful charge has yet been confirmed.
_Avoid_: Starting the boundary only at confirmed payment, releasing the CDK after a timeout or decline, treating an unknown write as no financial exposure

**Fulfillment Attempt**:
An append-only execution record for one pass through a membership-fulfillment stage. Retrying or operator-resuming creates another attempt without replacing the fulfillment, its prior evidence, reservation, or funding intent.
_Avoid_: New fulfillment per retry, resetting history, reusing session-delivery attempt counters

**Browser Fulfillment Lease**:
The exclusive, system-wide right for one membership-fulfillment stage to perform checkout in an isolated temporary browser for at most five minutes. Read-only subscription, inventory, transaction, and reconciliation work does not require this lease.
_Avoid_: Concurrent payment browsers, extending the hard deadline with heartbeats, treating separate profiles as permission for concurrency

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
The stage-bound, single-use bundle of the protected Session, full card details, fresh billing record, and validation contract released to the owning checkout execution only after its lease, card reservation, and permit binding are revalidated. It exists only in fulfillment-service, checkout-executor, and browser memory and is never a queue payload or persistent browser record.
_Avoid_: Stored card profile, reusable checkout secret, task-embedded payment material, executor-held card-platform credential

**Checkout Address Wait**:
An order-level retry state entered before checkout when KaWang's address API is unavailable or returns an incomplete Delaware record. Automatic fulfillment does not use a third-party address site or submit an incomplete form while waiting.
_Avoid_: Browser scraping fallback, submitting without required billing fields

**Session-Driven Checkout Entry**:
The Python checkout executor locally chunks the protected order Session's `sessionToken` into allowlisted ChatGPT Cookies, verifies the authenticated account identity, and uses the official checkout API inside the isolated payment browser with the fulfillment workflow's fixed `billing_details={country:PH,currency:PHP}`, hosted UI request, and Plus pricing-modal contract. The Starting Subscription Guard must already have passed. A reviewed hosted response navigates only to its allowlisted URL; a `custom_checkout_session` remains on the authenticated ChatGPT origin and mounts Stripe Checkout Elements from its memory-only client secret after independently validating the Stripe Session currency and amount. Python never converts a custom Session ID into a ChatGPT checkout route and cannot alter the target, region, currency, price contract, or destination allowlist.
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
The checkout-executor release contract that recognizes checkout states, fields, progression controls, and the final payment control for a known UI version. It can change only through a reviewed executor release and new rollout qualification, never through remotely supplied selectors or executable code.
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
The single-use immutable facts authorized for one live-canary payment: order, target tier, selected card, funding budget, checkout price-contract version, and checkout-adapter version. A changed fact invalidates the approval, and final payment activation consumes it atomically.
_Avoid_: Permanent approved flag, time-window replay, approval surviving a changed payment plan

**Canary Approval Hold**:
The maximum five-minute execution-lease period in which a prepared live-canary stage waits for its matching approval snapshot. Expiry releases the sanitized browser context and invalidates the page snapshot without releasing card capacity, moving funds, or replaying an already completed stage.
_Avoid_: Indefinite global queue pause, approval surviving a rebuilt page, repeating Plus after an upgrade hold expires

**Tier Rollout Qualification**:
The independently earned permission prerequisite for broad automation of one versioned Plus, x5, or x20 checkout path and PHP price contract, established by one complete live canary whose card payment settles, target membership confirms, renewal is disabled, and exercised adapter path has no unresolved outcome. Every target-tier canary is self-contained: Plus performs one stage, while x5 and x20 each perform their own same-order Plus stage followed by the target-specific upgrade. No qualification from another order is required to start a canary; the completed target canary qualifies only its own automatic scope.
_Avoid_: Treating an x5/x20 intermediate Plus stage as a separate order or global Plus qualification, requiring another tier before a live canary, pending authorization as rollout proof, automatic promotion, reusing evidence across versions

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
A fulfillment state in which a recognized payment flow requires 3DS, CAPTCHA, bank verification, or another human action. The active checkout browser and card reservation retain the global serial queue for no more than its five-minute hard deadline; after a post-submit handoff, resumption performs confirmation only rather than another payment submission.
_Avoid_: Bypassing the challenge, switching cards, resubmitting payment after handoff

**Human Challenge Acknowledgement**:
The private local handoff action by which an operator confirms that they finished interacting with the retained checkout browser. For a post-submit challenge it authorizes confirmation queries only and never authorizes another checkout submission.
_Avoid_: Remote blind resume, automatic DOM-based acknowledgement, treating acknowledgement as payment success

**Lost Challenge Context**:
A human-required checkout whose owning execution, page, or browser no longer exists. Its order remains under workflow-owned membership and transaction reconciliation while the sanitized serial payment queue continues with another order.
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
The authorized `gptserve.freespaces.app` service that receives an order's protected ChatGPT Session from the fulfillment workflow and reports the current account type for starting eligibility and payment-stage confirmation. The checkout executor does not use its response to decide that an order or stage is complete.
_Avoid_: Browser-side membership query, persisting the provider's raw response

**Confirmed Account Type**:
The allowlisted membership type reported by the membership state provider: `free` for no paid membership, `plus` for Plus, `prolite` for x5, and `pro` for x20. Any missing or unknown value is contract drift rather than evidence of a free account.
_Avoid_: Expecting `x5` or `x20` from the provider, treating null or an unknown enum as free, using UI labels as API enums

**Eligible Starting Membership**:
A ChatGPT account state that may enter automatic card fulfillment: an authoritative observation reports both `plan=free` and automatic renewal disabled. Every paid, delinquent, unknown, or renewal-enabled state remains in the Starting Subscription Guard and cannot reserve or fund a card or enter checkout.
_Avoid_: Treating delinquency or checkout availability as purchase eligibility, waiting only on a guessed expiry, replacing an existing paid plan

**Account Repurchase Wait**:
The no-funding state after the Starting Subscription Guard has disabled automatic renewal but the authoritative account observation is not yet `plan=free` with renewal disabled. It may be rechecked with the submitted Session, but it cannot reserve, open, fund, or expose a payment card or enter checkout.
_Avoid_: Assuming cancellation success means free, treating delinquency as purchasable, funding before the Free starting state is proven

**Renewal-Safe Completion**:
A confirmed target membership whose newly enabled automatic renewal has been disabled and authoritatively rechecked before the redeem order completes. Neither a checkout response nor a renewal-cancellation response alone can complete the order; an x5/x20 fulfillment does not disable renewal during its intermediate Plus stage.
_Avoid_: Completing from a checkout success page, trusting a cancellation response without re-querying, completing while auto-renew remains enabled, cancelling between staged-upgrade payments
