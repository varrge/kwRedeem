# KaWang Domain

KaWang manages redeemable cards, external site integrations, and operational data that must survive deployment and server moves.

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
