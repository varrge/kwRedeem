# Accept SpaceX unlimited funding snapshots as local liability budgets

Status: accepted; supersedes only the unconditional unlimited-authorization block in ADR-0009.

When SpaceX returns `owner_funding_cap_minor=0` with `unlimited_cap=1`, KaWang may continue fulfillment only under an explicitly enabled, freshly authenticated owner policy and only when the same immutable provider snapshot contains a positive `open_and_balance_minor` and currency. KaWang records that amount as a local funding liability, labels the asset as snapshot-budgeted, and keeps the fact that the upstream authorization remains unlimited visible; it never represents the budget as an upstream cap. This accepts greater provider-charge risk in exchange for compatibility with SpaceX's current CDK contract, while rejecting missing, malformed, plan-mismatched, non-positive, or mutable snapshots.

For a previously blocked unused asset, recovery must verify the exact upstream CDK is still `unused`, matches the snapshotted plan, has no wrapper or activation, and belongs to the original fulfillment unit. Recovery reuses that asset and idempotency identity, creates no replacement issuance, and is audit logged before the original task is resumed.
